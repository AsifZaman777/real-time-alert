#!/usr/bin/env python3
"""
Super Live News Stream Scraper — 45 Bangladeshi News Portals (English & Bangla)
===============================================================================
High-volume real-time news ingestion engine built for Apache Spark Structured
Streaming, Parquet Lakehouse storage, and the BigWarn Mobile Edge Disruption
Alert Platform.

Watches the home page, RSS/XML feeds, AND discovered category pages of 45
Bangladeshi newspapers, wire agencies, online portals, and TV news portals
(15 English + 30 Bangla), finds every article published TODAY (Dhaka time,
UTC+6), extracts full article text, metadata, and bilingual local disruption
pre-tags (event types, locations, time windows), and streams them to JSONL.

Output (in --out-dir):
    logs/news_stream_YYYY-MM-DD.log     human readable log, one file per Dhaka day
    logs/news_stream_YYYY-MM-DD.jsonl   Spark-ready JSONL stream (one JSON object per line)
    seen_urls.json                      memory of handled articles, so a restart does not repeat
Dashboard: add --ui and open http://127.0.0.1:8765 (needs news_dashboard.py next to this file;
           it can also run alone:  python news_dashboard.py --logs logs)

Install:   pip install requests beautifulsoup4
Run:       python live_news_stream.py
Test:      python live_news_stream.py --check        (verify each site's rules)
           python live_news_stream.py --once         (one round, then stop)
Options:   python live_news_stream.py --help
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import robotparser
from urllib.parse import unquote, urldefrag, urljoin, urlparse

import warnings
import requests
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

DHAKA = timezone(timedelta(hours=6))  # Bangladesh has no daylight saving time

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

FALLBACK_BROWSER_UAS = [
    (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) "
        "Gecko/20100101 Firefox/132.0"
    ),
    (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/18.1 Safari/605.1.15"
    ),
]

# ---------------------------------------------------------------- sources ---
# article_re : full (https, canonical host, no query, no trailing slash) URL of an article
# id_re      : group 1 = the article id, used so one story reached through two URLs counts once
# need_og_article : the article pattern is loose, so confirm with og:type=article on the page
# seeds      : category paths always scanned in addition to the discovered ones
# feeds      : RSS / Atom / XML feed URLs checked every round for instant discovery
# pages      : pagination pattern for the first-round backfill of category pages
# cat_depth  : max path segments of a category URL found in the navigation
# lang       : 'en' (English) or 'bn' (Bangla)
SITE_DEFS = [
    # ======================= ENGLISH NEWSPAPERS & PORTALS (15) =======================
    {
        "key": "prothomalo", "name": "Prothom Alo", "names": ["Prothom Alo"],
        "lang": "en",
        "home": "https://en.prothomalo.com/", "host": "en.prothomalo.com",
        "article_re": r"^https://en\.prothomalo\.com/(?!collection/|search|topic/|api/)(?:[a-z0-9-]+/)+[a-z0-9]{10}$",
        "id_re": r"/([a-z0-9]{10})$",
        "need_og_article": True,
        "feeds": ["https://en.prothomalo.com/feed/"],
        "seeds": ["bangladesh", "bangladesh/city", "bangladesh/local-news", "bangladesh/crime-and-law",
                  "bangladesh/government", "bangladesh/politics", "bangladesh/accident",
                  "international", "sports", "opinion", "business", "youth", "entertainment", "lifestyle", "environment"],
    },
    {
        "key": "thedailystar", "name": "The Daily Star", "names": ["The Daily Star", "Daily Star"],
        "lang": "en",
        "home": "https://www.thedailystar.net/", "host": "www.thedailystar.net",
        "article_re": r"^https://www\.thedailystar\.net/(?:[a-z0-9-]+/)+[a-z0-9%._-]+-\d{6,}$",
        "id_re": r"-(\d{6,})$",
        "need_og_article": False,
        "feeds": ["https://www.thedailystar.net/frontpage/rss.xml"],
        "seeds": ["news/bangladesh", "news/bangladesh/crime-justice", "news/bangladesh/politics",
                  "news/bangladesh/accidents-fires", "news/bangladesh/transport", "news/world",
                  "business", "sports", "opinion", "entertainment", "lifestyle", "tech-startup", "environment"],
        "pages": "?page={n}", "cat_depth": 3,
    },
    {
        "key": "dhakatribune", "name": "Dhaka Tribune", "names": ["Dhaka Tribune"],
        "lang": "en",
        "home": "https://www.dhakatribune.com/", "host": "www.dhakatribune.com",
        "article_re": r"^https://www\.dhakatribune\.com/(?:[a-z0-9-]+/)+\d{5,7}/[^/]+$",
        "id_re": r"/(\d{5,7})/",
        "need_og_article": False,
        "seeds": ["bangladesh", "bangladesh/dhaka", "bangladesh/nation", "bangladesh/crime",
                  "bangladesh/politics", "bangladesh/laws-rights", "business", "world", "sport", "opinion", "feature"],
        "cat_depth": 3,
    },
    {
        "key": "tbs", "name": "The Business Standard", "names": ["The Business Standard", "TBS"],
        "lang": "en",
        "home": "https://www.tbsnews.net/", "host": "www.tbsnews.net",
        "article_re": (r"^https://www\.tbsnews\.net/(?!bangla/)(?:(?:[a-z0-9-]+/)+[a-z0-9%._-]+-\d{4,7}"
                       r"|node/\d{4,7})$"),
        "id_re": r"(?:-|node/)(\d{4,7})$",
        "need_og_article": False,
        "feeds": ["https://www.tbsnews.net/rss.xml"],
        "seeds": ["latest", "bangladesh", "bangladesh/crime", "bangladesh/politics", "bangladesh/transport",
                  "economy", "world", "features", "sports"],
        "pages": "?page={n}",
    },
    {
        "key": "newage", "name": "New Age", "names": ["New Age", "New Age Bangladesh"],
        "lang": "en",
        "home": "https://www.newagebd.net/", "host": "www.newagebd.net",
        "article_re": (r"^https://www\.newagebd\.net/(?:post|article)/(?:[a-z0-9-]+/)*"
                       r"\d{4,7}(?:/[^/]+)?$"),
        "id_re": r"/(\d{4,7})(?:/|$)",
        "need_og_article": False,
        "seeds": ["latest", "articlelist/41/bangladesh", "articlelist/49/country",
                  "articlelist/42/politics", "articlelist/29/business-economy"],
        "cat_depth": 3,
    },
    {
        "key": "dailysun", "name": "Daily Sun", "names": ["Daily Sun", "The Daily Sun"],
        "lang": "en",
        "home": "https://www.daily-sun.com/", "host": "www.daily-sun.com",
        "article_re": r"^https://www\.daily-sun\.com/(?!post-logu|my-districts)(?:[a-z0-9-]+/)+\d{5,7}(?:/[^/]+)?$",
        "id_re": r"/(\d{5,7})(?:/|$)",
        "need_og_article": False,
        "seeds": ["national", "country", "politics", "economy", "business", "sports", "world"],
    },
    {
        "key": "financialexpress", "name": "The Financial Express",
        "names": ["The Financial Express", "Financial Express"],
        "lang": "en",
        "home": "https://thefinancialexpress.com.bd/", "host": "thefinancialexpress.com.bd",
        "article_re": (r"^https://thefinancialexpress\.com\.bd/"
                       r"(?!bangla/|tag/|reporter/|print/|page/|about-us|epaper|category/|all-news)"
                       r"(?:[a-z0-9-]+/)+[a-z0-9-]{10,}$"),
        "id_re": r"-(\d{9,11})$",
        "need_og_article": True,
        "seeds": ["category/national", "category/economy", "category/trade", "category/stock",
                  "category/world", "category/sports", "category/lifestyle",
                  "economy", "stock", "national", "world", "sports", "lifestyle"],
    },
    {
        "key": "bss", "name": "Bangladesh Sangbad Sangstha", "names": ["BSS", "Bangladesh Sangbad Sangstha"],
        "lang": "en",
        "home": "https://www.bssnews.net/", "host": "www.bssnews.net",
        "article_re": (r"^https://www\.bssnews\.net/(?!bangla/|about-bss/|contact-us/)"
                       r"[a-z-]+/\d{5,7}(?:/[^/]+)?$"),
        "id_re": r"/(\d{5,7})(?:/|$)",
        "need_og_article": False,
        "seeds": ["news/national", "news/top-news", "news/politics", "news/district-news", "news/business"],
    },
    {
        "key": "bdnews24", "name": "bdnews24.com", "names": ["bdnews24.com", "bdnews24"],
        "lang": "en",
        "home": "https://bdnews24.com/", "host": "bdnews24.com",
        "article_re": r"^https://bdnews24\.com/(?!tube/|photos/|bangla/|media-en/)[a-z-]+/(?:[a-z-]+/)?[a-z0-9-]{8,}$",
        "need_og_article": True,
        "feeds": ["https://bdnews24.com/?widgetName=rssfeed&widgetId=1150&getXmlFeed=true"],
        "seeds": ["bangladesh", "politics", "economy", "business", "world", "sport",
                  "opinion", "entertainment", "lifestyle", "technology", "health",
                  "environment", "education", "campus", "media"],
    },
    {
        "key": "unb", "name": "United News of Bangladesh", "names": ["UNB", "United News of Bangladesh"],
        "lang": "en",
        "home": "https://unb.com.bd/", "host": "unb.com.bd",
        "article_re": r"^https://unb\.com\.bd/category/[A-Za-z0-9-]+/[^/]+/\d+$",
        "id_re": r"/(\d+)$",
        "need_og_article": False,
        "seeds": ["latestnews", "category/Bangladesh", "category/Politics", "category/City", "category/Economy"],
        "section_re": r"/category/([^/]+)/",
    },
    {
        "key": "observerbd", "name": "The Daily Observer", "names": ["The Daily Observer", "Daily Observer"],
        "lang": "en",
        "home": "https://observerbd.com/", "host": "observerbd.com",
        "article_re": r"^https://observerbd\.com/news/\d{5,7}$",
        "id_re": r"/news/(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["menu/193", "menu/194", "menu/195", "menu/197", "menu/198", "menu/199"],
    },
    {
        "key": "bangladeshpost", "name": "Bangladesh Post", "names": ["Bangladesh Post", "The Bangladesh Post"],
        "lang": "en",
        "home": "https://bangladeshpost.net/", "host": "bangladeshpost.net",
        "article_re": r"^https://bangladeshpost\.net/posts/[a-z0-9-]+-\d{5,7}$",
        "id_re": r"-(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["categories/national", "categories/city", "categories/country", "categories/politics", "categories/economy"],
    },
    {
        "key": "banglanews24_en", "name": "banglanews24.com (English)", "names": ["banglanews24.com", "banglanews24"],
        "lang": "en",
        "home": "https://en.banglanews24.com/", "host": "en.banglanews24.com",
        "article_re": r"^https://en\.banglanews24\.com/[a-z-]+/news/bd/\d{5,7}\.details$",
        "id_re": r"/(\d{5,7})\.details$",
        "need_og_article": False,
        "seeds": ["category/national", "category/politics", "category/economics", "category/international"],
    },
    {
        "key": "dailycountrytoday", "name": "The Daily Country Today", "names": ["The Daily Country Today", "Daily Country Today"],
        "lang": "en",
        "home": "https://dailycountrytodaybd.com/", "host": "dailycountrytodaybd.com",
        "article_re": r"^https://dailycountrytodaybd\.com/story/[^/]{10,}$",
        "need_og_article": False,
        "feeds": ["https://dailycountrytodaybd.com/feed"],
        "seeds": ["category/national", "category/politics", "category/country", "category/business"],
    },
    {
        "key": "viewsbangladesh", "name": "Views Bangladesh", "names": ["Views Bangladesh"],
        "lang": "en",
        "home": "https://viewsbangladesh.com/", "host": "viewsbangladesh.com",
        "article_re": r"^https://viewsbangladesh\.com/(?!category/|authors/|tag/|about|contact|privacy|terms)[a-z0-9-]{18,}$",
        "need_og_article": True,
        "seeds": ["category/current-affairs", "category/current-affairs/national",
                  "category/current-affairs/city", "category/current-affairs/crime", "category/economy"],
        "cat_depth": 3,
    },

    # ======================= BANGLA NEWSPAPERS, PORTALS & TV (30) =======================
    {
        "key": "prothomalo_bn", "name": "Prothom Alo (Bangla)", "names": ["প্রথম আলো", "Prothom Alo"],
        "lang": "bn",
        "home": "https://www.prothomalo.com/", "host": "www.prothomalo.com",
        "article_re": r"^https://www\.prothomalo\.com/(?!collection/|search|topic/|video/|photo/|api/)(?:[a-z0-9-]+/)+[a-z0-9]{10}$",
        "id_re": r"/([a-z0-9]{10})$",
        "need_og_article": True,
        "feeds": ["https://www.prothomalo.com/feed/"],
        "seeds": ["collection/latest", "bangladesh", "bangladesh/capital", "bangladesh/district",
                  "bangladesh/crime", "politics", "business", "world", "sports"],
    },
    {
        "key": "bdnews24_bn", "name": "bdnews24.com (Bangla)", "names": ["বিডিনিউজ টোয়েন্টিফোর ডটকম", "bdnews24.com"],
        "lang": "bn",
        "home": "https://bangla.bdnews24.com/", "host": "bangla.bdnews24.com",
        "article_re": r"^https://bangla\.bdnews24\.com/(?!tube/|photos/|media-bn/)[a-z0-9-]+/(?:[a-z0-9-]+/)?[a-z0-9]{10}$",
        "id_re": r"/([a-z0-9]{10})$",
        "need_og_article": False,
        "seeds": ["bangladesh", "politics", "Samagrabangladesh", "economy", "business", "world", "sport"],
    },
    {
        "key": "thedailystar_bn", "name": "The Daily Star (Bangla)", "names": ["দ্য ডেইলি স্টার", "The Daily Star Bangla"],
        "lang": "bn",
        "home": "https://bangla.thedailystar.net/", "host": "bangla.thedailystar.net",
        "article_re": r"^https://bangla\.thedailystar\.net/(?:[a-z0-9-]+/)+news-\d{6,8}$",
        "id_re": r"news-(\d{6,8})$",
        "need_og_article": False,
        "seeds": ["news/bangladesh", "news/bangladesh/crime-justice", "news/bangladesh/politics",
                  "business", "international", "sports"],
        "cat_depth": 3,
    },
    {
        "key": "dhakatribune_bn", "name": "Dhaka Tribune (Bangla)", "names": ["ঢাকা ট্রিবিউন", "Dhaka Tribune Bangla"],
        "lang": "bn",
        "home": "https://bangla.dhakatribune.com/", "host": "bangla.dhakatribune.com",
        "article_re": r"^https://bangla\.dhakatribune\.com/(?:[a-z0-9-]+/)+\d{5,7}/[^/]+$",
        "id_re": r"/(\d{5,7})/",
        "need_og_article": False,
        "seeds": ["bangladesh", "politics", "economy", "international", "sport"],
    },
    {
        "key": "tbs_bn", "name": "The Business Standard (Bangla)", "names": ["দ্য বিজনেস স্ট্যান্ডার্ড", "TBS Bangla"],
        "lang": "bn",
        "home": "https://www.tbsnews.net/bangla/", "host": "www.tbsnews.net",
        "article_re": r"^https://www\.tbsnews\.net/bangla/(?:[^/]+/)+news-details-\d{5,7}$",
        "id_re": r"news-details-(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["bangla/bangladesh", "bangla/nationwide", "bangla/Economy", "bangla/international"],
    },
    {
        "key": "bss_bn", "name": "BSS (Bangla)", "names": ["বাসস", "বাংলাদেশ সংবাদ সংস্থা"],
        "lang": "bn",
        "home": "https://www.bssnews.net/bangla/", "host": "www.bssnews.net",
        "article_re": r"^https://www\.bssnews\.net/bangla/(?!about-bss|contact-us|archive)[a-z-]+/\d{5,7}(?:/[^/]+)?$",
        "id_re": r"/(\d{5,7})(?:/|$)",
        "need_og_article": False,
        "seeds": ["bangla/national/national-news", "bangla/national/district-news", "bangla/national/politics"],
        "cat_depth": 3,
    },
    {
        "key": "unb_bn", "name": "UNB (Bangla)", "names": ["ইউএনবি", "UNB Bangla"],
        "lang": "bn",
        "home": "https://unb.com.bd/bangla/", "host": "unb.com.bd",
        "article_re": r"^https://unb\.com\.bd/bangla/category/[^/]+/[^/]+/\d{4,7}$",
        "id_re": r"/(\d{4,7})$",
        "need_og_article": False,
        "seeds": ["bangla/latestnews"],
        "section_re": r"/bangla/category/([^/]+)/",
    },
    {
        "key": "jugantor", "name": "Daily Jugantor", "names": ["যুগান্তর", "Daily Jugantor", "Jugantor"],
        "lang": "bn",
        "home": "https://www.jugantor.com/", "host": "www.jugantor.com",
        "article_re": r"^https://www\.jugantor\.com/(?!topic/|categories|todays-paper)[a-z0-9-]+/\d{6,8}$",
        "id_re": r"/(\d{6,8})$",
        "need_og_article": False,
        "seeds": ["latest", "national", "politics", "capital", "country-news", "economics", "international"],
    },
    {
        "key": "ittefaq", "name": "The Daily Ittefaq", "names": ["দৈনিক ইত্তেফাক", "Daily Ittefaq", "Ittefaq"],
        "lang": "bn",
        "home": "https://www.ittefaq.com.bd/", "host": "www.ittefaq.com.bd",
        "article_re": r"^https://www\.ittefaq\.com\.bd/\d{5,7}/[^/]+$",
        "id_re": r"^https://www\.ittefaq\.com\.bd/(\d{5,7})/",
        "need_og_article": False,
        "seeds": ["latest-news", "national", "politics", "capital", "country", "business", "world-news"],
    },
    {
        "key": "samakal", "name": "Daily Samakal", "names": ["সমকাল", "Daily Samakal", "Samakal"],
        "lang": "bn",
        "home": "https://samakal.com/", "host": "samakal.com",
        "article_re": r"^https://samakal\.com/(?:[a-z0-9-]+/)+article/\d{5,7}/[^/]+$",
        "id_re": r"/article/(\d{5,7})/",
        "need_og_article": False,
        "seeds": ["latest/news", "bangladesh", "politics", "capital", "whole-country", "economics", "international"],
    },
    {
        "key": "dhakapost", "name": "Dhaka Post", "names": ["ঢাকা পোস্ট", "Dhaka Post"],
        "lang": "bn",
        "home": "https://www.dhakapost.com/", "host": "www.dhakapost.com",
        "article_re": r"^https://www\.dhakapost\.com/(?!topic/)(?:[a-z0-9-]+/)+\d{5,7}$",
        "id_re": r"/(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["latest-news", "national", "politics", "country", "economy", "crime", "international"],
    },
    {
        "key": "banglanews24_bn", "name": "banglanews24.com (Bangla)", "names": ["বাংলানিউজটোয়েন্টিফোর.কম", "banglanews24"],
        "lang": "bn",
        "home": "https://www.banglanews24.com/", "host": "www.banglanews24.com",
        "article_re": r"^https://www\.banglanews24\.com/[a-z-]+/news/bd/\d{6,8}\.details$",
        "id_re": r"/(\d{6,8})\.details$",
        "need_og_article": False,
        "seeds": ["category/জাতীয়/1", "category/রাজনীতি/2", "category/অর্থনীতি-ব্যবসা/3", "category/সারাদেশ/10"],
    },
    {
        "key": "jamuna", "name": "Jamuna TV", "names": ["যমুনা টিভি", "Jamuna TV", "Jamuna Television"],
        "lang": "bn",
        "home": "https://www.jamuna.tv/", "host": "www.jamuna.tv",
        "article_re": r"^https://www\.jamuna\.tv/(?!topic/|categories)[a-z0-9-]+/\d{5,7}$",
        "id_re": r"/(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["national", "politics", "all-bangladesh", "crime", "economy", "international"],
    },
    {
        "key": "independent24", "name": "Independent TV", "names": ["ইনডিপেনডেন্ট টিভি", "Independent TV", "itvbd"],
        "lang": "bn",
        "home": "https://www.itvbd.com/", "host": "www.itvbd.com",
        "article_re": r"^https://www\.itvbd\.com/(?:[a-z0-9-]+/)+\d{5,7}/[^/]+$",
        "id_re": r"/(\d{5,7})/",
        "need_og_article": False,
        "seeds": ["latest", "national", "country", "politics", "economy", "world"],
    },
    {
        "key": "rtvonline", "name": "RTV Online", "names": ["আরটিভি", "RTV Online", "RTV"],
        "lang": "bn",
        "home": "https://rtvonline.com/", "host": "rtvonline.com",
        "article_re": r"^https://rtvonline\.com/(?:[a-z0-9-]+/)+\d{5,7}$",
        "id_re": r"/(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["all-news", "national", "politics", "country", "economy", "international"],
    },
    {
        "key": "ntvbd", "name": "NTV Online", "names": ["এনটিভি", "NTV Online", "NTV"],
        "lang": "bn",
        "home": "https://www.ntvbd.com/", "host": "www.ntvbd.com",
        "article_re": r"^https://www\.ntvbd\.com/(?:[a-z0-9-]+/)+news-\d{6,8}$",
        "id_re": r"news-(\d{6,8})$",
        "need_og_article": False,
        "seeds": ["bangladesh", "world", "economy", "sports", "crime"],
    },
    {
        "key": "ekattor", "name": "Ekattor TV", "names": ["একাত্তর টিভি", "Ekattor TV", "Ekattor"],
        "lang": "bn",
        "home": "https://ekattor.tv/", "host": "ekattor.tv",
        "article_re": r"^https://ekattor\.tv/(?!topic/)(?:[a-z0-9-]+/)+\d{4,7}/[^/]+$",
        "id_re": r"/(\d{4,7})/",
        "need_og_article": False,
        "seeds": ["latest-news", "national", "politics", "country", "business", "international"],
    },
    {
        "key": "banglatribune", "name": "Bangla Tribune", "names": ["বাংলা ট্রিবিউন", "Bangla Tribune"],
        "lang": "bn",
        "home": "https://www.banglatribune.com/", "host": "www.banglatribune.com",
        "article_re": r"^https://www\.banglatribune\.com/(?!topic/)(?:[a-z0-9-]+/)+\d{5,7}/[^/]+$",
        "id_re": r"/(\d{5,7})/",
        "need_og_article": False,
        "seeds": ["national", "politics", "country", "law-and-crime", "business", "foreign"],
    },
    {
        "key": "sarabangla", "name": "SaraBangla", "names": ["সারাবাংলা", "SaraBangla", "Sarabangla.net"],
        "lang": "bn",
        "home": "https://sarabangla.net/", "host": "sarabangla.net",
        "article_re": r"^https://sarabangla\.net/(?:[a-z0-9-]+/)+post-\d{6,8}$",
        "id_re": r"post-(\d{6,8})$",
        "need_og_article": False,
        "seeds": ["news", "bangladesh", "news/national", "news/politics", "news/crime", "news/country"],
    },
    {
        "key": "ajkerpatrika", "name": "Ajker Patrika", "names": ["আজকের পত্রিকা", "Ajker Patrika"],
        "lang": "bn",
        "home": "https://www.ajkerpatrika.com/", "host": "www.ajkerpatrika.com",
        "article_re": r"^https://www\.ajkerpatrika\.com/(?!topic/)(?:[a-z0-9-]+/)+ajp[a-z0-9]{8,14}$",
        "id_re": r"/(ajp[a-z0-9]{8,14})$",
        "need_og_article": False,
        "seeds": ["latest-news", "national", "politics", "country", "crime", "business"],
    },
    {
        "key": "deshrupantor", "name": "Desh Rupantor", "names": ["দেশ রূপান্তর", "Desh Rupantor"],
        "lang": "bn",
        "home": "https://www.deshrupantor.com/", "host": "www.deshrupantor.com",
        "article_re": r"^https://www\.deshrupantor\.com/\d{5,7}/[^/]+$",
        "id_re": r"^https://www\.deshrupantor\.com/(\d{5,7})/",
        "need_og_article": False,
        "seeds": ["latest-news", "national", "politics", "capital", "country", "international"],
    },
    {
        "key": "mzamin", "name": "Daily Manab Zamin", "names": ["মানবজমিন", "Daily Manab Zamin", "Manab Zamin"],
        "lang": "bn",
        "home": "https://www.mzamin.com/", "host": "www.mzamin.com",
        "article_re": r"^https://www\.mzamin\.com/article/\d{4,7}$",
        "id_re": r"/article/(\d{4,7})$",
        "need_og_article": False,
        "seeds": ["newstoday"],
    },
    {
        "key": "bhorerkagoj", "name": "Bhorer Kagoj", "names": ["ভোরের কাগজ", "Bhorer Kagoj"],
        "lang": "bn",
        "home": "https://www.bhorerkagoj.net/", "host": "www.bhorerkagoj.net",
        "article_re": r"^https://www\.bhorerkagoj\.net/(?!topic/|categories)[a-z0-9-]+/\d{5,7}$",
        "id_re": r"/(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["national", "politics", "country", "economics", "international"],
    },
    {
        "key": "shomoyeralo", "name": "Daily Shomoyer Alo", "names": ["সময়ের আলো", "Daily Shomoyer Alo", "Shomoyer Alo"],
        "lang": "bn",
        "home": "https://www.shomoyeralo.com/", "host": "www.shomoyeralo.com",
        "article_re": r"^https://www\.shomoyeralo\.com/news/\d{5,7}$",
        "id_re": r"/news/(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["menu/102", "menu/107", "menu/108", "menu/109", "menu/115"],
    },
    {
        "key": "sangbad", "name": "Daily Sangbad", "names": ["দৈনিক সংবাদ", "Daily Sangbad", "Sangbad"],
        "lang": "bn",
        "home": "https://sangbad.net/", "host": "sangbad.net",
        "article_re": r"^https://sangbad\.net/news/\d{4,7}$",
        "id_re": r"/news/(\d{4,7})$",
        "need_og_article": False,
        "seeds": [],
    },
    {
        "key": "janakantha", "name": "Daily Janakantha", "names": ["দৈনিক জনকণ্ঠ", "Daily Janakantha", "Janakantha"],
        "lang": "bn",
        "home": "https://www.dailyjanakantha.com/", "host": "www.dailyjanakantha.com",
        "article_re": r"^https://www\.dailyjanakantha\.com/(?:[a-z0-9-]+/)+news/\d{5,7}$",
        "id_re": r"/news/(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["national", "politics", "bangladesh", "economy", "international"],
    },
    {
        "key": "manobkantha", "name": "Daily Manobkantha", "names": ["মানবকণ্ঠ", "Daily Manobkantha", "Manobkantha"],
        "lang": "bn",
        "home": "https://manobkantha.com.bd/", "host": "manobkantha.com.bd",
        "article_re": r"^https://manobkantha\.com\.bd/news/[^/]+/\d{5,7}/[^/]+$",
        "id_re": r"/(\d{5,7})/",
        "need_og_article": False,
        "seeds": ["articlelist/1/national", "articlelist/2/politics", "articlelist/3/country"],
        "cat_depth": 3,
    },
    {
        "key": "dhakatimes24", "name": "Dhaka Times 24", "names": ["ঢাকা টাইমস", "Dhaka Times 24", "dhakatimes24"],
        "lang": "bn",
        "home": "https://www.dhakatimes24.com/", "host": "www.dhakatimes24.com",
        "article_re": r"^https://www\.dhakatimes24\.com/\d{4}/\d{2}/\d{2}/\d{5,7}$",
        "id_re": r"/(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["national", "politics", "all-bangladesh", "economy"],
    },
    {
        "key": "arthosuchak", "name": "Arthosuchak", "names": ["অর্থসূচক", "Arthosuchak"],
        "lang": "bn",
        "home": "https://www.arthosuchak.com/", "host": "www.arthosuchak.com",
        "article_re": r"^https://www\.arthosuchak\.com/archives/\d{5,7}/[^/]+$",
        "id_re": r"/archives/(\d{5,7})/",
        "need_og_article": False,
        "seeds": [],
    },
    {
        "key": "sharebiz", "name": "ShareBiz", "names": ["শেয়ার বিজ", "ShareBiz"],
        "lang": "bn",
        "home": "https://www.sharebiz.net/", "host": "www.sharebiz.net",
        "article_re": r"^https://www\.sharebiz\.net/[a-z0-9-]+/news/\d{5,7}$",
        "id_re": r"/news/(\d{5,7})$",
        "need_og_article": False,
        "seeds": ["national", "daily", "economy"],
    },
]

# Paths that are never news categories (used only when discovering categories).
# Prevents crawling user/auth/utility endpoints (e.g. /user, /post-logu, /my-districts) that return HTTP 403.
NOT_CATEGORY = re.compile(
    r"/(?:tags?|topics?|authors?|reporters?|page|print|printversion|search|about|about-us|"
    r"contact|contact-us|e-?paper|archive|archives|photos?|photo-gallery|gallery|videos?|video-gallery|"
    r"tube|live|live-tv|rss|feed|sitemap|login|signin|logout|signout|register|signup|auth|oauth|"
    r"user|users|account|profile|dashboard|admin|wp-admin|wp-login|wp-json|api|cdn-cgi|cgi-bin|"
    r"post-logu|my-districts|poll|polls|quiz|weather|horoscope|namaz|prayer|unicode|converter|"
    r"todays-paper|rate-card|circulation|editorial|staff|disclaimer|cookies?|ads|subscribe|subscriber|"
    r"privacy[a-z-]*|terms[a-z-]*|advertis[a-z-]*|cartoons?|taxonomy|node|jobs?|careers?|"
    r"comment-policy|policy|bn-converter)(?=/|$)",
    re.I,
)
SECTION_STOP = {"news", "category", "post", "posts", "article", "archives", "story", "node", "en", "bangla", "bd"}

# Generic site-level meta descriptions to ignore in favor of article body lead paragraph
GENERIC_DESC_RE = re.compile(
    r"(?:leading\s+English\s+language\s+daily\s+newspaper|major\s+source\s+of\s+news\s+of\s+Bangladesh|"
    r"latest\s+bangla\s+news|online\s+news\s+portal)",
    re.I,
)


def compile_sites(only: set[str] | None, lang_filter: str | None = None) -> list[dict]:
    sites = []
    for d in SITE_DEFS:
        if only and d["key"] not in only:
            continue
        if lang_filter and d.get("lang", "en") != lang_filter:
            continue
        s = dict(d)
        s.setdefault("lang", "en")
        s.setdefault("feeds", [])
        s["article_re"] = re.compile(d["article_re"])
        s["id_re"] = re.compile(d["id_re"]) if d.get("id_re") else None
        s["section_re"] = re.compile(d["section_re"]) if d.get("section_re") else None
        s["title_re"] = re.compile(
            r"\s*[|\u2013\u2014-]\s*(?:%s)\s*$" % "|".join(re.escape(n) for n in d["names"]), re.I)
        s.setdefault("cat_depth", 2)
        s.setdefault("pages", None)
        sites.append(s)
    return sites


# -------------------------------------- bilingual date & text normalization ---
def now_dhaka() -> datetime:
    return datetime.now(DHAKA)


MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}

BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
BN_MONTH_MAP = [
    (r"জানু(?:য়ারি|য়ারি|য়ারী|য়ারী)?", "January"),
    (r"ফেব্রু(?:য়ারি|য়ারি|য়ারী|য়ারী)?", "February"),
    (r"মার্চ", "March"),
    (r"এপ্রিল", "April"),
    (r"মে", "May"),
    (r"জুন", "June"),
    (r"জুলাই", "July"),
    (r"আগস্ট|অগাস্ট", "August"),
    (r"সেপ্টেম্বর", "September"),
    (r"অক্টোবর", "October"),
    (r"নভেম্বর", "November"),
    (r"ডিসেম্বর", "December"),
]
BN_AMPM_MAP = [
    (r"পিএম|অপরাহ্ণ|অপরাহ্ন|বিকাল|বিকেল|সন্ধ্যা|রাত", "PM"),
    (r"এএম|পূর্বাহ্ণ|পূর্বাহ্ন|সকাল|ভোর", "AM"),
]

PUBLISHED_LABEL = r"(?:Published|Publish|Posted|প্রকাশিত|প্রকাশের\s+তারিখ|প্রকাশকাল|প্রকাশ)"
UPDATED_LABEL = r"(?:Updated?|Last\s+updated?|Modified|আপডেট|হালনাগাদ)"


def normalize_bn_date_text(text: str) -> str:
    """Translates Bengali digits, month names, and AM/PM markers into English equivalents."""
    if not text:
        return ""
    s = text.translate(BN_DIGITS)
    for pat, eng in BN_MONTH_MAP:
        s = re.sub(pat, f" {eng} ", s)
    for pat, eng in BN_AMPM_MAP:
        s = re.sub(r"(?<!\w)" + pat + r"(?!\w)", f" {eng} ", s)
    return s


def parse_iso(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    s = normalize_bn_date_text(value.strip()).strip()
    s = s.replace("Z", "+00:00")
    s = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", s)
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        # Fallback for non-ISO strings stored in JSON-LD / meta tags (e.g. '10:32, 3 November 2026')
        return parse_text_date("", s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=DHAKA)
    return dt.astimezone(DHAKA)


def _make_date(day, mon, year, hh=None, mm=None, ap=None) -> datetime | None:
    month = MONTHS.get(str(mon).strip()[:3].lower())
    if not month:
        return None
    h = int(hh or 0)
    if ap:
        ap_low = ap.strip().lower()
        h = h % 12 + (12 if ap_low == "pm" else 0)
    try:
        return datetime(int(year), month, int(day), h, int(mm or 0), tzinfo=DHAKA)
    except ValueError:
        return None


def parse_text_date(label: str, text: str) -> datetime | None:
    """Reads visible dates in both English and Bangla such as:
         'Published : 23 Oct 2013, 06:00 PM'      'Updated: 29 Oct 2026, 05: 48'
         'Published : Sunday, 11 January, 2026 at 12:00 AM'
         'Published at 03:15 pm April 19th, 2013'
         'Update- November 03, 2026, 12:16 PM'    'Published : Nov 03, 2026, 04:43'
         'প্রকাশ: ০৩ নভেম্বর ২০২৬, ১৫:৩০ পিএম'     'প্রকাশিত: ১০:৩২, ৩ নভেম্বর ২০২৬'
    """
    norm = normalize_bn_date_text(text)
    prefix = (label + r"\s*(?:at|on)?\s*[:\-]?\s*") if label else r""
    weekday = r"(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*,?\s*|(?:রবি|সোম|মঙ্গল|বুধ|বৃহস্পতি|শুক্র|শনি)বার,?\s*)?"

    # Pattern 1: [Label] [Weekday,] DD Month YYYY [, HH:MM [AM/PM]]
    m = re.search(
        prefix + weekday + r"(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})"
        r"(?:\s*(?:,|at|\|)?\s*(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*\d{2})?\s*([AaPp][Mm])?)?",
        norm, re.I)
    if m:
        day, mon, year, hh, mm, ap = m.groups()
        d = _make_date(day, mon, year, hh, mm, ap)
        if d:
            return d

    # Pattern 2: [Label] [Weekday,] Month DD, YYYY [, HH:MM [AM/PM]]  (UNB, Financial Express, Daily Country Today)
    m = re.search(
        prefix + weekday + r"([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})"
        r"(?:\s*(?:,|at|\|)?\s*(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*\d{2})?\s*([AaPp][Mm])?)?",
        norm, re.I)
    if m:
        mon, day, year, hh, mm, ap = m.groups()
        d = _make_date(day, mon, year, hh, mm, ap)
        if d:
            return d

    # Pattern 3: [Label] HH:MM [AM/PM] [,] Month DD, YYYY  or  HH:MM [AM/PM] [,] DD Month YYYY
    m = re.search(
        prefix + r"(\d{1,2})\s*:\s*(\d{2})\s*([AaPp][Mm])?,?\s+" + weekday +
        r"([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})",
        norm, re.I)
    if m:
        hh, mm, ap, mon, day, year = m.groups()
        d = _make_date(day, mon, year, hh, mm, ap)
        if d:
            return d

    m = re.search(
        prefix + r"(\d{1,2})\s*:\s*(\d{2})\s*([AaPp][Mm])?,?\s+" + weekday +
        r"(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})",
        norm, re.I)
    if m:
        hh, mm, ap, day, mon, year = m.groups()
        d = _make_date(day, mon, year, hh, mm, ap)
        if d:
            return d

    return None


# ---------------------- Spark & Mobile Edge Disruption Pre-Tagging ------------
_BACKEND_PARENT = Path(__file__).resolve().parents[3]
if str(_BACKEND_PARENT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_PARENT))
from backend.ingestion.enrichment.taxonomy import extract_disruption_tags  # noqa: E402


# ---------------------------------------------------------------- helpers ---
def same_host(a: str, b: str) -> bool:
    def strip(h):
        h = h.lower()
        return h[4:] if h.startswith("www.") else h
    return strip(a) == strip(b)


def clean_url(url: str, site: dict) -> str:
    url = urldefrag(url)[0].split("?")[0].rstrip("/")
    p = urlparse(url)
    path = re.sub(r"/\./", "/", p.path)
    path = re.sub(r"/{2,}", "/", path)
    if p.scheme in ("http", "https") and same_host(p.netloc, site["host"]):
        url = f"https://{site['host']}{path}"
    return url


def art_key(site: dict, url: str) -> str:
    """Identity of an article: always prefixed with site['key']: so seen_stats groups by portal."""
    if site["id_re"]:
        m = site["id_re"].search(url)
        if m:
            return f"{site['key']}:{m.group(1)}"
    slug = urlparse(url).path.strip("/") or url
    return f"{site['key']}:{slug}"


def robots_token(ua: str) -> str:
    m = re.search(r"compatible;\s*([\w-]+)", ua)
    return m.group(1) if m else "*"


class Fetcher:
    """One per site: a session with realistic browser headers, Referer, 403 UA rotation, and robots.txt rules."""

    def __init__(self, user_agent: str, verbose: bool, check_robots: bool = True, home_url: str = ""):
        self.s = requests.Session()
        self.home_url = home_url
        self.s.headers.update({
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,bn-BD,bn;q=0.8",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
        })
        if home_url:
            self.s.headers["Referer"] = home_url
        self.ua = user_agent
        self.verbose = verbose
        self.check_robots = check_robots
        self.rp: robotparser.RobotFileParser | None = None
        self.crawl_delay: float = 0.0
        self.status = 0

    def load_robots(self, home: str) -> None:
        self.home_url = home
        self.s.headers["Referer"] = home
        p = urlparse(home)
        text = self.get(f"{p.scheme}://{p.netloc}/robots.txt", tries=1, robots=False, quiet_403=True)
        if text is None:
            return  # no robots.txt reachable, so nothing says no
        rp = robotparser.RobotFileParser()
        rp.parse(text.splitlines())
        self.rp = rp
        cd = rp.crawl_delay(robots_token(self.ua))
        if cd:
            self.crawl_delay = min(float(cd), 5.0)

    def allowed(self, url: str) -> bool:
        if not self.check_robots or self.rp is None:
            return True
        path = urlparse(url).path or "/"
        # Never allow restricted user/auth/logout paths that return 403
        if NOT_CATEGORY.search(path if path.endswith("/") else path + "/"):
            if any(tok in path.lower() for tok in ("/user", "/post-logu", "/my-districts", "/login", "/logout", "/admin")):
                return False
        return self.rp.can_fetch(robots_token(self.ua), url)

    def get(self, url: str, tries: int = 2, robots: bool = True, quiet_403: bool = False) -> str | None:
        if robots and not self.allowed(url):
            self.status = -1
            if self.verbose:
                print(f"   ! robots.txt/policy disallows {url}", file=sys.stderr)
            return None
        p = urlparse(url)
        site_origin = f"{p.scheme}://{p.netloc}/" if p.scheme and p.netloc else self.home_url
        for attempt in range(tries):
            try:
                req_headers = {"Referer": self.home_url or site_origin}
                if attempt > 0:
                    # Rotate User-Agent on retry to recover from strict WAF/CDN 403 blocks
                    req_headers["User-Agent"] = FALLBACK_BROWSER_UAS[
                        (attempt - 1) % len(FALLBACK_BROWSER_UAS)
                    ]
                    req_headers["Cache-Control"] = "no-cache"
                r = self.s.get(url, headers=req_headers, timeout=18)
                self.status = r.status_code
                if r.status_code == 200:
                    if "charset" not in r.headers.get("Content-Type", "").lower():
                        r.encoding = "utf-8"
                    return r.text
                if r.status_code == 403 and attempt == 0 and tries < 2:
                    # Always do at least one rotated-UA retry on 403 before giving up
                    r2 = self.s.get(
                        url,
                        headers={
                            "Referer": self.home_url or site_origin,
                            "User-Agent": FALLBACK_BROWSER_UAS[0],
                            "Cache-Control": "no-cache",
                        },
                        timeout=18,
                    )
                    self.status = r2.status_code
                    if r2.status_code == 200:
                        if "charset" not in r2.headers.get("Content-Type", "").lower():
                            r2.encoding = "utf-8"
                        return r2.text
                if r.status_code in (404, 410):
                    return None
                if r.status_code == 403 and attempt + 1 < max(2, tries):
                    time.sleep(0.6)
                    continue
                if (self.verbose or r.status_code in (403, 429)) and not quiet_403:
                    print(f"   ! HTTP {r.status_code} for {url}", file=sys.stderr)
                if r.status_code == 403:
                    return None
            except requests.RequestException as e:
                self.status = 0
                if self.verbose:
                    print(f"   ! {type(e).__name__} for {url}", file=sys.stderr)
            time.sleep(1.0 * (attempt + 1))
        return None


def extract_links(html: str, base: str, site: dict) -> dict[str, str]:
    """Article links on a listing page, in page order: {article key: url}."""
    soup = BeautifulSoup(html, "html.parser")
    out: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        url = clean_url(urljoin(base, href), site)
        if site["article_re"].match(url):
            out.setdefault(art_key(site, url), url)
    return out


def extract_feed_links(xml_text: str, base: str, site: dict) -> dict[str, str]:
    """Extracts article links from an RSS, Atom, or XML Sitemap feed."""
    out: dict[str, str] = {}
    for m in re.finditer(r"<(?:link|loc)>\s*(?:<!\[CDATA\[)?\s*(https?://[^\s<>\]]+)", xml_text, re.I):
        url = clean_url(m.group(1).strip(), site)
        if site["article_re"].match(url):
            out.setdefault(art_key(site, url), url)
    if not out:
        out.update(extract_links(xml_text, base, site))
    return out


def parse_rss_date(raw_date: str | None) -> datetime | None:
    """Parses RFC-2822 RSS <pubDate> or ISO-8601 <published>/<updated> into Dhaka time."""
    if not raw_date:
        return None
    s = raw_date.strip()
    dt_iso = parse_iso(s)
    if dt_iso:
        return dt_iso
    try:
        from email.utils import parsedate_to_datetime
        d = parsedate_to_datetime(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=DHAKA)
        return d.astimezone(DHAKA)
    except Exception:
        return parse_text_date("", s)


def extract_feed_items(xml_text: str, base: str, site: dict, allow_syndicated: bool = False) -> dict[str, dict]:
    """
    Extracts structured RSS/Atom feed items ({key: {url, headline, published, description, body}})
    so that if an individual article HTML page returns HTTP 403 from a datacenter WAF,
    the scraper can still emit the verified article from the feed item without failing.
    """
    soup = BeautifulSoup(xml_text, "html.parser")
    items_by_key: dict[str, dict] = {}
    for node in soup.find_all(["item", "entry"]):
        title_tag = node.find("title")
        if not title_tag:
            continue
        raw_title = title_tag.get_text(" ", strip=True)
        headline = site["title_re"].sub("", raw_title).strip()
        if not headline or len(headline) < 8:
            continue

        link_url = ""
        link_tag = node.find("link")
        if link_tag:
            link_url = (link_tag.get("href") or link_tag.get_text(" ", strip=True) or "").strip()
        if not link_url:
            m_link = re.search(r"<link[^>]*>\s*(?:<!\[CDATA\[)?\s*(https?://[^\s<>\]]+)", str(node), re.I)
            if m_link:
                link_url = m_link.group(1).strip()
        if not link_url:
            guid_tag = node.find("guid")
            if guid_tag:
                g_txt = guid_tag.get_text(" ", strip=True)
                if g_txt.startswith("http"):
                    link_url = g_txt
        if not link_url:
            continue

        url = clean_url(urljoin(base, link_url), site)
        if not allow_syndicated and not site["article_re"].match(url):
            continue

        pub_dt = None
        for dtag_name in ("pubdate", "published", "updated", "dc:date", "date"):
            dtag = node.find(dtag_name)
            if dtag:
                pub_dt = parse_rss_date(dtag.get_text(" ", strip=True))
                if pub_dt:
                    break

        desc_html = ""
        for ctag_name in ("content:encoded", "content", "description", "summary"):
            ctag = node.find(ctag_name)
            if ctag:
                txt = ctag.get_text(" ", strip=True)
                if len(txt) > len(desc_html):
                    desc_html = txt
        clean_desc = BeautifulSoup(desc_html, "html.parser").get_text(" ", strip=True) if desc_html else ""
        clean_desc = site["title_re"].sub("", clean_desc).strip()

        k = art_key(site, url)
        items_by_key[k] = {
            "url": url,
            "headline": headline,
            "published": pub_dt,
            "description": clean_desc[:300] if clean_desc else headline,
            "body": clean_desc if len(clean_desc) >= 40 else headline,
        }
    return items_by_key


def fetch_syndicated_rss_items(f: Fetcher, site: dict) -> dict[str, dict]:
    """
    Fallback public RSS syndication query for `site:<host>` when a portal's Cloudflare WAF
    returns HTTP 403 to datacenter IPs on direct HTML requests.
    """
    is_bn = site.get("lang") == "bn"
    hl = "bn" if is_bn else "en-BD"
    ceid = "BD:bn" if is_bn else "BD:en"
    host = site["host"].removeprefix("www.")
    rss_url = f"https://news.google.com/rss/search?q=site:{host}+when:1d&hl={hl}&gl=BD&ceid={ceid}"
    xml_text = f.get(rss_url, tries=1, robots=False, quiet_403=True)
    if not xml_text:
        return {}
    return extract_feed_items(xml_text, site["home"], site, allow_syndicated=True)


def build_article_from_feed_item(fitem: dict, url: str, site: dict) -> dict:
    """Builds a full article dictionary from an RSS/Atom feed item when HTML page returns 403."""
    title = fitem["headline"]
    desc = fitem.get("description") or title
    body = fitem.get("body") or desc
    tags_info = extract_disruption_tags(title, desc, body)
    return {
        "kind": "article",
        "headline": title,
        "description": desc,
        "body": body,
        "word_count": len(body.split()) if body else len(desc.split()),
        "keywords": [],
        "author": "",
        "section": _section_from_url(url, site),
        "published": fitem.get("published") or now_dhaka(),
        "updated": fitem.get("published"),
        "lang": site.get("lang", "en"),
        "site_key": site.get("key", ""),
        **tags_info,
    }


def discover_categories(html: str, site: dict, limit: int) -> list[str]:
    """Category pages found in the site's own navigation, plus the seed categories."""
    home = site["home"]
    cats: list[str] = []
    seen: set[str] = set()

    def add(url: str):
        if url not in seen and clean_url(url, site) != clean_url(home, site):
            seen.add(url)
            cats.append(url)

    for s in site["seeds"]:
        add(clean_url(urljoin(home, s), site))
    soup = BeautifulSoup(html, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        url = clean_url(urljoin(home, href), site)
        p = urlparse(url)
        if not same_host(p.netloc, site["host"]):
            continue
        parts = [x for x in p.path.split("/") if x]
        if not parts or len(parts) > site["cat_depth"]:
            continue
        if any(x.isdigit() for x in parts):
            continue
        if len(parts[-1].split("-")) > 4:      # long hyphenated slug = an article, not a category
            continue
        if NOT_CATEGORY.search("/" + "/".join(parts) + "/"):
            continue
        if site.get("lang") == "en" and any(x in ("bangla", "bn") for x in parts):
            continue
        if site["article_re"].match(url) and not site["need_og_article"]:
            continue
        add(url)
    return cats[:limit]


def _iter_ld(node):
    if isinstance(node, list):
        for x in node:
            yield from _iter_ld(x)
    elif isinstance(node, dict):
        yield node
        if "@graph" in node:
            yield from _iter_ld(node["@graph"])


def _section_from_url(url: str, site: dict) -> str:
    if site["section_re"]:
        m = site["section_re"].search(url)
        if m:
            return unquote(m.group(1))
    parts = [p for p in urlparse(url).path.split("/") if p]
    if not parts:
        return "-"
    last_is_id = parts[-1].isdigit() or bool(re.match(r"^(?:news-\d+|post-\d+|\d+\.details|ajp[a-z0-9]+)$", parts[-1]))
    keep = [unquote(p) for p in parts if not p.isdigit() and p.lower() not in SECTION_STOP]
    if not last_is_id and keep:
        keep = keep[:-1]  # the last piece is the article slug
    return "/".join(keep) or "-"


def _extract_body_text(soup: BeautifulSoup, ld_body: str) -> str:
    """Extracts clean full-article body text for Spark NLP & Lakehouse storage."""
    if ld_body and len(ld_body.strip()) >= 180:
        return re.sub(r"\s+", " ", ld_body).strip()

    # Check common article body containers across Bangladeshi news portals
    selectors = [
        "article",
        "[itemprop='articleBody']",
        ".story-element-text",
        ".article-content",
        ".news-article",
        ".dtl_section",
        ".news_details",
        ".details-content",
        ".entry-content",
        ".paragraph",
        "#dtl_part",
        "#f",
    ]
    paras: list[str] = []
    for sel in selectors:
        nodes = soup.select(sel)
        if nodes:
            for node in nodes:
                for p in node.find_all(["p", "div"], recursive=True):
                    if p.find(["p", "div"]):
                        continue
                    t = p.get_text(" ", strip=True)
                    if len(t) >= 35 and not re.search(r"Copyright\s*©|সর্বস্বত্ব\s*সংরক্ষিত|প্রকাশক\s*ও\s*সম্পাদক", t, re.I):
                        if t not in paras:
                            paras.append(t)
            if sum(len(x) for x in paras) >= 150:
                break

    if not paras:
        for p in soup.find_all("p"):
            t = p.get_text(" ", strip=True)
            if len(t) >= 40 and not re.search(r"Copyright\s*©|সর্বস্বত্ব\s*সংরক্ষিত|প্রকাশক\s*ও\s*সম্পাদক", t, re.I):
                if t not in paras:
                    paras.append(t)

    return "\n\n".join(paras[:40]).strip()


def parse_article(html: str, url: str, site: dict) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")

    def meta(*names):
        for n in names:
            for attr in ("property", "name", "itemprop"):
                tag = soup.find("meta", attrs={attr: n})
                if tag and tag.get("content"):
                    return tag["content"].strip()
        return None

    if site["need_og_article"] and (meta("og:type") or "").lower() != "article":
        return {"kind": "not_article"}

    title = meta("og:title", "twitter:title")
    if not title:
        h1 = soup.find("h1")
        title = h1.get_text(" ", strip=True) if h1 else None
    if not title:
        return None
    title = site["title_re"].sub("", title).strip()

    published = updated = None
    author = meta("author", "article:author")
    section = meta("article:section")
    ld_body = ""
    keywords: list[str] = []

    kw_meta = meta("keywords", "news_keywords", "article:tag")
    if kw_meta:
        keywords.extend(k.strip() for k in kw_meta.split(",") if k.strip())

    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "", strict=False)
        except (ValueError, TypeError):
            continue
        for item in _iter_ld(data):
            published = published or parse_iso(item.get("datePublished"))
            updated = updated or parse_iso(item.get("dateModified"))
            if item.get("articleBody") and isinstance(item.get("articleBody"), str):
                if len(item["articleBody"]) > len(ld_body):
                    ld_body = item["articleBody"]
            if not author and item.get("author"):
                a = item["author"]
                a = a if isinstance(a, list) else [a]
                names = [x.get("name") if isinstance(x, dict) else x for x in a]
                author = ", ".join(n for n in names[:3] if isinstance(n, str)) or None
            if not section and item.get("articleSection"):
                sec = item["articleSection"]
                section = ", ".join(sec) if isinstance(sec, list) else str(sec)
            if item.get("keywords"):
                kw = item["keywords"]
                if isinstance(kw, list):
                    keywords.extend(str(x).strip() for x in kw if str(x).strip())
                elif isinstance(kw, str):
                    keywords.extend(k.strip() for k in kw.split(",") if k.strip())

    published = published or parse_iso(meta(
        "article:published_time", "og:article:published_time", "datePublished",
        "pubdate", "publish-date", "date", "DC.date.issued"))
    updated = updated or parse_iso(meta(
        "article:modified_time", "og:updated_time", "dateModified", "last-modified"))

    # Check explicit article date containers (e.g. BSS Bangla .entry_update, Daily Country Today .entry-meta)
    if not published:
        for sel in (".entry_update", ".entry-meta", ".pub", ".date-time", ".post-date"):
            el = soup.select_one(sel)
            if el:
                dt = parse_text_date("", el.get_text(" ", strip=True))
                if dt:
                    published = dt
                    break

    text = soup.get_text(" ", strip=True)
    published = published or parse_text_date(PUBLISHED_LABEL, text)
    updated = updated or parse_text_date(UPDATED_LABEL, text)

    if not published:
        t = soup.find("time", attrs={"itemprop": "datePublished"}) or soup.find("time", attrs={"datetime": True})
        if t is not None:
            published = parse_iso(t.get("datetime")) or parse_text_date("", t.get_text(" ", strip=True))

    body = _extract_body_text(soup, ld_body)
    desc = meta("og:description", "description", "twitter:description") or ""
    if (not desc or GENERIC_DESC_RE.search(desc)) and body:
        desc = body.split("\n\n")[0][:300]

    dedup_kw = list(dict.fromkeys(k for k in keywords if 1 < len(k) <= 60))[:15]
    tags_info = extract_disruption_tags(title, desc, body)

    return {
        "kind": "article",
        "headline": title,
        "description": desc,
        "body": body,
        "word_count": len(body.split()) if body else len(desc.split()),
        "keywords": dedup_kw,
        "author": author or "",
        "section": section or _section_from_url(url, site),
        "published": published,
        "updated": updated,
        "lang": site.get("lang", "en"),
        "site_key": site.get("key", ""),
        **tags_info,
    }


# ----------------------------------------------------------------- output ---
class Output:
    """Writes one pair of files per Dhaka day: logs/news_stream_YYYY-MM-DD.log / .jsonl.
    A new pair starts by itself at midnight, so a long run never makes one giant file."""

    def __init__(self, folder: Path):
        folder.mkdir(parents=True, exist_ok=True)
        self.folder = folder
        self.logdir = folder / "logs"
        self.logdir.mkdir(exist_ok=True)
        self.seen_path = folder / "seen_urls.json"
        self.lock = threading.Lock()
        self.headlines: dict[str, str] = {}   # normalised headline -> first source
        self.day = None
        self.log = self.jsonl = None
        self._roll(now_dhaka())

    def _roll(self, ts: datetime) -> None:
        if ts.date() == self.day:
            return
        for f in (self.log, self.jsonl):
            if f:
                f.close()
        self.day = ts.date()
        self.headlines.clear()   # "also in" only compares stories of the same day
        stem = self.logdir / f"news_stream_{self.day:%Y-%m-%d}"
        self.log = open(f"{stem}.log", "a", encoding="utf-8")
        self.jsonl = open(f"{stem}.jsonl", "a", encoding="utf-8")

    @staticmethod
    def _norm(h: str) -> str:
        return re.sub(r"[^\w]+", " ", h.lower(), flags=re.UNICODE).strip()

    def emit(self, source: str, url: str, art: dict) -> None:
        ts = now_dhaka()
        fmt = lambda d: d.strftime("%Y-%m-%d %H:%M") if d else "unknown"
        with self.lock:
            self._roll(ts)
            norm = self._norm(art["headline"])
            dup = None
            if len(norm) >= 18:
                dup = self.headlines.get(norm)
                self.headlines.setdefault(norm, source)

            ev_types = art.get("event_types") or []
            locs = art.get("locations") or []
            alert_badge = ""
            if ev_types or locs:
                parts = []
                if ev_types:
                    parts.append("events=" + ",".join(ev_types))
                if locs:
                    parts.append("areas=" + ",".join(locs[:4]))
                alert_badge = f" [{'; '.join(parts)}]"

            line = (
                f"[{ts:%Y-%m-%d %H:%M:%S}] NEW | {source} | {art['headline']}"
                + (f"  (also in {dup})" if dup and dup != source else "")
                + alert_badge
                + f"\n    link: {url}\n"
                f"    published: {fmt(art['published'])} | updated: {fmt(art['updated'])} "
                f"| section: {art['section']}"
                + (f" | by: {art['author']}" if art["author"] else "")
            )
            print(line, flush=True)
            self.log.write(line + "\n")
            self.log.flush()
            self.jsonl.write(json.dumps({
                "event": "NEW",
                "ingested_at": ts.isoformat(timespec="seconds"),
                "source": source,
                "site_key": art.get("site_key", ""),
                "lang": art.get("lang", "en"),
                "url": url,
                "headline": art["headline"],
                "description": art["description"],
                "body": art.get("body", ""),
                "word_count": art.get("word_count", 0),
                "keywords": art.get("keywords", []),
                "author": art["author"],
                "section": art["section"],
                "published": art["published"].isoformat() if art["published"] else None,
                "updated": art["updated"].isoformat() if art["updated"] else None,
                "duplicate_of": dup if dup and dup != source else None,
                "is_disruption": art.get("is_disruption", False),
                "event_types": ev_types,
                "locations": locs,
                "time_windows": art.get("time_windows", []),
            }, ensure_ascii=False) + "\n")
            self.jsonl.flush()

    def note(self, text: str) -> None:
        """Status line: shown on screen and kept in the day's .log with a timestamp."""
        ts = now_dhaka()
        with self.lock:
            print(text, flush=True)
            self._roll(ts)
            for ln in text.strip("\n").splitlines():
                self.log.write(f"[{ts:%Y-%m-%d %H:%M:%S}] INFO | {ln.strip()}\n")
            self.log.flush()

    def load_seen(self) -> dict:
        try:
            raw = json.loads(self.seen_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                # Automatically purge transient 'failed' or 'robots' entries on load so
                # previously 403-blocked articles are retried with the updated browser headers
                return {
                    k: v
                    for k, v in raw.items()
                    if v not in ("failed", "robots", "http_403")
                }
            return {}
        except (OSError, ValueError):
            return {}

    def save_seen(self, seen: dict) -> None:
        tmp = self.seen_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(seen, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.seen_path)


# ------------------------------------------------------------------ cycle ---
def classify(art: dict) -> str:
    ref = art["published"] or art["updated"]
    if ref is None:
        return "nodate"
    return "today" if ref.date() == now_dhaka().date() else "old"


class Ctx:
    def __init__(self, args, out, seen, fetchers):
        self.args, self.out, self.seen, self.fetchers = args, out, seen, fetchers
        self.stop = threading.Event()
        self.state: dict[str, dict] = {}   # per site: cats, cursor, disc_round, streak, skip_until
        self.fails: dict[str, int] = {}
        self.seen_lock = threading.Lock()


def pause(ctx: Ctx, lo: float, hi: float, floor: float) -> None:
    ctx.stop.wait(max(random.uniform(lo, hi), floor))


def scrape_site(ctx: Ctx, site: dict, round_no: int, first_round: bool) -> int:
    args, out, seen = ctx.args, ctx.out, ctx.seen
    f = ctx.fetchers[site["key"]]
    st = ctx.state.setdefault(site["key"], {"cats": None, "cursor": 0, "disc_round": 0,
                                            "streak": 0, "skip_until": 0})
    if round_no < st["skip_until"]:
        return 0

    links: dict[str, str] = {}
    feed_items: dict[str, dict] = {}

    home_html = f.get(site["home"], quiet_403=True)
    if home_html is not None:
        st["streak"] = 0
        # --- explore categories ---------------------------------------------
        if st["cats"] is None or (not args.no_categories and round_no - st["disc_round"] >= args.rediscover):
            if args.no_categories:
                st["cats"] = []
            else:
                st["cats"] = discover_categories(home_html, site, args.max_categories)
            st["disc_round"] = round_no
            if args.verbose or first_round:
                out.note(f"   {site['name']} ({site.get('lang', 'en').upper()}): "
                         f"{len(st['cats'])} categor{'y' if len(st['cats']) == 1 else 'ies'} to watch")

        cats = st["cats"] or []
        if first_round:
            batch = list(cats)
        elif cats:
            k = min(args.cats_per_round, len(cats))
            batch = [cats[(st["cursor"] + i) % len(cats)] for i in range(k)]
            st["cursor"] = (st["cursor"] + k) % len(cats)
        else:
            batch = []

        links.update(extract_links(home_html, site["home"], site))
    else:
        batch = [clean_url(urljoin(site["home"], s), site) for s in site.get("seeds", [])[:3]]

    # --- check configured RSS/Atom/XML feeds --------------------------------
    for feed_url in site.get("feeds", []):
        if ctx.stop.is_set():
            return 0
        xml_text = f.get(feed_url, tries=1, quiet_403=True)
        if xml_text:
            for k2, u2 in extract_feed_links(xml_text, feed_url, site).items():
                links.setdefault(k2, u2)
            for k2, item2 in extract_feed_items(xml_text, feed_url, site).items():
                feed_items.setdefault(k2, item2)
                links.setdefault(k2, item2["url"])

    # --- check category pages -----------------------------------------------
    for cat in batch:
        if ctx.stop.is_set():
            return 0
        npages = args.backfill_pages if (first_round and site["pages"]) else 1
        for n in range(npages):
            url = cat if n == 0 else cat + site["pages"].format(n=n)
            pause(ctx, 0.3, 0.8, f.crawl_delay)
            html = f.get(url, quiet_403=True)
            if html is None:
                break
            for k2, u2 in extract_links(html, url, site).items():
                links.setdefault(k2, u2)

    # --- RSS Syndication Fallback when direct HTML is blocked (403) on datacenter IP ---
    if not links:
        syndicated = fetch_syndicated_rss_items(f, site)
        for k2, item2 in syndicated.items():
            feed_items.setdefault(k2, item2)
            links.setdefault(k2, item2["url"])

    if not links and home_html is None:
        st["streak"] += 1
        st["skip_until"] = round_no + min(10, 2 ** st["streak"])
        return 0

    # --- download only unseen articles, capped per round --------------------
    with ctx.seen_lock:
        todo = [(k, u) for k, u in links.items() if k not in seen]
    cap = args.first_round_max if first_round else args.max_articles
    quiet = first_round and args.from_now
    new_today = 0
    for key, url in todo[:cap]:
        if ctx.stop.is_set():
            break
        pause(ctx, args.article_pause_min, args.article_pause_max, f.crawl_delay)
        page = f.get(url, quiet_403=True) if home_html is not None else None
        art = parse_article(page, url, site) if page else None

        # If direct HTML fetch returned 403/None or failed to parse, use structured RSS feed item
        if (art is None or art.get("kind") != "article") and key in feed_items:
            art = build_article_from_feed_item(feed_items[key], url, site)
        elif art and art.get("kind") == "article" and not art.get("published") and key in feed_items:
            art["published"] = feed_items[key].get("published")

        if art is None:
            continue
        if art["kind"] == "not_article":
            with ctx.seen_lock:
                seen[key] = "skip"
            continue
        status = classify(art)
        with ctx.seen_lock:
            seen[key] = status
        if status == "nodate" and args.verbose:
            out.note(f"   ? {site['name']}: no date found, ignored: {url}")
        if status == "today":
            new_today += 1
            if not quiet:
                out.emit(site["name"], url, art)
    if args.verbose and len(todo) > cap:
        out.note(f"   {site['name']}: {len(todo) - cap} more unseen link(s) left for the next round")
    return new_today


def safe_scrape(ctx, site, round_no, first_round) -> int:
    try:
        return scrape_site(ctx, site, round_no, first_round)
    except Exception as e:  # one broken site must never stop the others
        ctx.out.note(f"   ! {site['name']}: {type(e).__name__}: {e}")
        return 0


# ------------------------------------------------------------------ check ---
def run_check(args, sites) -> None:
    """Quick health check of every site's rules against the live pages."""
    print(f"Checking {len(sites)} site(s) at {now_dhaka():%Y-%m-%d %H:%M:%S} Dhaka time\n")
    for site in sites:
        f = Fetcher(args.user_agent, args.verbose, check_robots=not args.ignore_robots)
        print(f"== [{site.get('lang', 'en').upper()}] {site['name']}  ({site['home']})")
        if not args.ignore_robots:
            f.load_robots(site["home"])
            if not f.allowed(site["home"]):
                print("   robots.txt does not allow this site, skipped\n")
                continue
        html = f.get(site["home"])
        if html is None:
            print(f"   home page not loaded (HTTP {f.status})\n")
            continue
        links = extract_links(html, site["home"], site)
        cats = discover_categories(html, site, args.max_categories)
        print(f"   article links on home page : {len(links)}")
        print(f"   categories found           : {len(cats)}  e.g. "
              + ", ".join(unquote(urlparse(c).path) or "/" for c in cats[:6]))
        sample = list(links.values())[:1]
        if not links and cats:
            time.sleep(0.5)
            h2 = f.get(cats[0])
            if h2:
                links = extract_links(h2, cats[0], site)
                sample = list(links.values())[:1]
                print(f"   article links on {unquote(urlparse(cats[0]).path)}: {len(links)}")
        if sample:
            time.sleep(0.5)
            page = f.get(sample[0])
            art = parse_article(page, sample[0], site) if page else None
            if art and art.get("kind") == "article":
                print(f"   sample article             : {art['headline'][:70]}")
                print(f"   date read                  : published={art['published']} "
                      f"updated={art['updated']} -> {classify(art)}")
                print(f"   body / tags                : {art.get('word_count', 0)} words | "
                      f"events={art.get('event_types')} | areas={art.get('locations')}")
            else:
                print(f"   sample article could not be parsed: {sample[0]}")
        else:
            print("   no article links matched: the URL pattern for this site needs a look")
        print()


# ------------------------------------------------------------------- main ---
def parse_args():
    p = argparse.ArgumentParser(
        description="Super live stream of today's Bangladeshi news from 45 English & Bangla portals"
    )
    p.add_argument("--min-delay", type=float, default=10, help="min seconds between rounds (default 10)")
    p.add_argument("--max-delay", type=float, default=20, help="max seconds between rounds (default 20)")
    p.add_argument("--out-dir", default=".", help="folder for the log files (default: current folder)")
    p.add_argument("--sites", default="", help="comma separated site keys to use (see --list-sites)")
    p.add_argument("--lang", choices=["all", "en", "bn"], default="all",
                   help="filter sources by language: all (default), en (English), or bn (Bangla)")
    p.add_argument("--list-sites", action="store_true", help="show the site keys and exit")
    p.add_argument("--check", action="store_true", help="test every site's rules once and exit")
    p.add_argument("--no-categories", action="store_true", help="read only the home pages")
    p.add_argument("--max-categories", type=int, default=30, help="categories watched per site (default 30)")
    p.add_argument("--cats-per-round", type=int, default=4,
                   help="category pages refreshed per site per round after the first round (default 4)")
    p.add_argument("--rediscover", type=int, default=120,
                   help="re-read the navigation for new categories every N rounds (default 120)")
    p.add_argument("--max-articles", type=int, default=50,
                   help="new article pages downloaded per site per round (default 50)")
    p.add_argument("--first-round-max", type=int, default=150,
                   help="same, for the first round (default 150); the rest follow in later rounds")
    p.add_argument("--backfill-pages", type=int, default=2,
                   help="extra pages read per category on the first round where a site has paging (default 2)")
    p.add_argument("--from-now", action="store_true",
                   help="do not print today's earlier articles, only ones published from now on")
    p.add_argument("--once", action="store_true", help="run one round and stop (for testing)")
    p.add_argument("--ignore-robots", action="store_true", help="skip the robots.txt check")
    p.add_argument("--user-agent", default=DEFAULT_UA)
    p.add_argument("--article-pause-min", type=float, default=0.25)
    p.add_argument("--article-pause-max", type=float, default=0.75)
    p.add_argument("--all-sections", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--ui", action="store_true", help="also serve the live dashboard in your browser")
    p.add_argument("--port", type=int, default=8765, help="dashboard port (default 8765)")
    return p.parse_args()


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    args = parse_args()

    if args.list_sites:
        for d in SITE_DEFS:
            print(f"{d['key']:20} [{d.get('lang', 'en').upper()}]  {d['name']:34} {d['home']}")
        return
    only = {x.strip() for x in args.sites.split(",") if x.strip()} or None
    if only:
        unknown = only - {d["key"] for d in SITE_DEFS}
        if unknown:
            sys.exit(f"Unknown site key(s): {', '.join(sorted(unknown))}. Use --list-sites.")
    lang_filter = None if args.lang == "all" else args.lang
    sites = compile_sites(only, lang_filter=lang_filter)

    if args.check:
        run_check(args, sites)
        return

    out = Output(Path(args.out_dir))
    if args.ui:
        try:
            import news_dashboard
            url = news_dashboard.start_in_thread(out.logdir, args.port)
            out.note(f"Dashboard: open {url} in your browser")
        except Exception as e:
            out.note(f"Dashboard could not start ({type(e).__name__}: {e}); scraping continues")
    fetchers = {
        s["key"]: Fetcher(
            args.user_agent,
            args.verbose,
            check_robots=not args.ignore_robots,
            home_url=s["home"],
        )
        for s in sites
    }

    if not args.ignore_robots:
        allowed = []
        for s in sites:
            f = fetchers[s["key"]]
            f.load_robots(s["home"])
            if f.allowed(s["home"]):
                allowed.append(s)
            else:
                out.note(f"robots.txt does not allow {s['home']}, skipping {s['name']} "
                         f"(use --ignore-robots only if you have permission)")
        sites = allowed
    if not sites:
        out.note("Nothing to scrape.")
        return

    seen = out.load_seen()
    ctx = Ctx(args, out, seen, fetchers)
    rounds, total_new = 0, 0
    en_count = sum(1 for s in sites if s.get("lang") == "en")
    bn_count = sum(1 for s in sites if s.get("lang") == "bn")
    out.note(f"Super live news stream started {now_dhaka():%Y-%m-%d %H:%M:%S} (Dhaka time). "
             f"Today = {now_dhaka():%d %b %Y}. Press Ctrl+C to stop.")
    out.note(f"Active sources: {len(sites)} ({en_count} English, {bn_count} Bangla): "
             f"{', '.join(s['name'] for s in sites)}")
    out.note(f"Wait {args.min_delay:.0f}-{args.max_delay:.0f}s between rounds. "
             f"Logs: {Path(args.out_dir).resolve()}")

    pool = ThreadPoolExecutor(max_workers=min(32, len(sites)))
    try:
        while True:
            rounds += 1
            futures = [(s, pool.submit(safe_scrape, ctx, s, rounds, rounds == 1)) for s in sites]
            counts = {s["name"]: fut.result() for s, fut in futures}
            new = sum(counts.values())
            total_new += new
            out.save_seen(seen)
            wait = random.uniform(args.min_delay, args.max_delay)
            detail = ", ".join(f"{n} {c}" for n, c in counts.items() if c)
            out.note(f"-- round {rounds} done at {now_dhaka():%H:%M:%S}: {new} new today"
                     + (f" ({detail})" if detail else "")
                     + f", {total_new} total this run. Next check in {wait:.0f}s")
            if args.once:
                break
            if ctx.stop.wait(wait):
                break
    except KeyboardInterrupt:
        ctx.stop.set()
    finally:
        ctx.stop.set()
        pool.shutdown(wait=True)
        out.save_seen(seen)
        out.note(f"\nStopped. {total_new} new articles streamed this run. "
                 f"Files: {out.logdir}")


if __name__ == "__main__":
    main()
