"""
Bilingual (English + Bangla) Threat & Disruption Event Taxonomy & Context-Aware Bangladesh Area Gazetteer.
Used by Stage 1 pre-tagging, Stage 3 Spark NLP enrichment, and Medallion Silver/Gold clustering.

Key Optimizations:
1. High-Threat Public Safety Focus: Filters strictly for active threats (gunfire/explosions, murder/violent crime,
   arson/severe fire, violent clashes, blockades, strikes, fatal accidents, and severe infrastructure paralysis).
2. Non-Threat Noise Suppression: Rejects routine 24h police arrest tallies, foreign news, climate grants, seminars,
   and newspaper footer addresses.
3. Context-Aware Clause-Level (Location -> Event) Linker:
   - Headline Location Authority: If the headline specifies location(s), body mentions of other places are not polluted.
   - Outside-Dhaka Headline Guard: Prevents national roundup bodies from dumping provincial headline stories into Dhaka wards.
   - Police Attribution & Bus-Route Direction Stripping: Ignores 'OC of Banani Police Station' or 'Jatrabari-bound bus'.
   - Clause-Level Co-occurrence: Maps each location strictly to the threat event occurring in the same clause, eliminating
     Cartesian-product cross-pollution (e.g., bus fire in Banani/Mohakhali vs crude bomb in Jatrabari).
"""
from __future__ import annotations

import html
import re

# High-Threat & Public Safety Event Taxonomy
EVENT_TAXONOMY: dict[str, re.Pattern] = {
    "gunfire": re.compile(
        r"\b(?:gunfire|shooting|shot\s+dead|open(?:ed)?\s+fire|gunfight|shootout|bullet[\s-]*hit|"
        r"gunshot\s+wound|crude\s+bomb[s]?|cocktail\s+bomb[s]?|cocktail[s]?\s+explod(?:ed|es)|"
        r"bomb\s+blast[s]?|bomb\s+explosion[s]?|petrol\s+bomb[s]?|grenade\s+attack|"
        r"hurled\s+(?:crude\s+)?bomb[s]?|detonat(?:ed|ion)\s+(?:crude\s+)?bomb[s]?)\b|"
        r"(?<![ঁ-৯অ-হ])(?:গুলিবর্ষণ|গোলাগুলি|গুলিবিদ্ধ|গুলি\s*ছোড়|গুলি\s*চালা|গুলিতে\s*(?:আহত|নিহত)|"
        r"গুলি\s*করে\s*(?:হত্যা|খুন|আহত)|বন্দুকযুদ্ধ|ফায়ারিং|ফায়ারিং|"
        r"ককটেল\s*বিস্ফোরণ|ককটেল\s*নিক্ষেপ|বোমা\s*বিস্ফোরণ|পেট্রলবোমা|পেট্রোল\s*বোমা|"
        r"গ্রেনেড\s*হামলা|ককটেল\s*হামলা|বিস্ফোরণে\s*আহত|বিস্ফোরণে\s*নিহত|ককটেল\s*ছোড়া|ককটেল\s*সদৃশ)",
        re.I,
    ),
    "murder": re.compile(
        r"\b(?:murder(?:ed)?(?!\s+case)|homicide|hacked\s+to\s+death|stabbed\s+to\s+death|stabbing|"
        r"lynch(?:ed|ing)|beaten\s+to\s+death|throat[\s-]*slit|dead\s+body\s+recovered|"
        r"body\s+recovered|armed\s+robbery|armed\s+attack|kidnap(?:ped|ping)|abduct(?:ed|ion)|"
        r"assassinat(?:ed|ion)|killed\s+in\s+(?:attack|clash|explosion|shootout))\b|"
        r"(?:হত্যাকাণ্ড|কুপিয়ে\s*হত্যা|কুপিয়ে\s*জখম|পিটিয়ে\s*হত্যা|গণপিটুনি|"
        r"গলাকেটে\s*হত্যা|গলা\s*কেটে\s*হত্যা|শ্বাসরোধে\s*হত্যা|গুলি\s*করে\s*হত্যা|"
        r"ছুরিকাঘাতে\s*নিহত|ছুরিকাঘাত|লাশ\s*উদ্ধার|মরদেহ\s*উদ্ধার|খুন\s*হয়েছেন|খুন\s*করা|"
        r"সশস্ত্র\s*হামলা|ডাকাতি|অপহরণ|পিটিয়ে\s*ও\s*গায়ে\s*আগুন|রক্তাক্ত\s*(?:যুবক|মরদেহ|লাশ))",
        re.I,
    ),
    "fire": re.compile(
        r"\b(?:fire\s+breaks?\s+out|caught\s+fire|gutted\s+by\s+fire|set\s+(?:on\s+fire|ablaze)|"
        r"torched|arson|bus(?:es)?\s+set\s+ablaze|vehicle[s]?\s+torched|massive\s+blaze|"
        r"inferno|burned\s+down|slum\s+blaze|battle[ds]?\s+.*?\s+blaze)\b|"
        r"(?:বাসে\s*আগুন|গাড়িতে\s*আগুন|ট্রাকে\s*আগুন|মোটরসাইকেলে\s*আগুন|অগ্নিসংযোগ|"
        r"ভয়াবহ\s*আগুন|অগ্নিকাণ্ড|আগুনে\s*পুড়ে|আগুন\s*দিয়েছে|আগুন\s*দেয়|আগুন\s*লাগার|"
        r"বস্তিতে\s*আগুন|ভবনে\s*আগুন|মার্কেটে\s*আগুন|কারখানায়\s*আগুন|ভস্মীভূত)",
        re.I,
    ),
    "clash": re.compile(
        r"\b(?:violent\s+clash(?:es)?|clash(?:es|ed)?|chase\s+and\s+counter[\s-]*chase|"
        r"brickbat[s]?|tear\s*gas|sound\s+grenade[s]?|baton\s+charge|"
        r"vandal(?:ism|ised|ized)|riot(?:s|ing)?|ransack(?:ed)?)\b|"
        r"(?:সংঘর্ষ|ধাওয়া[\s-]*পাল্টা\s*ধাওয়া|ইটপাটকেল|টিয়ার\s*শেল|টিয়ারশেল|"
        r"সাউন্ড\s*গ্রেনেড|রাবার\s*বুলেট|ভাঙচুর|লাঠিচার্জ|রণক্ষেত্র|সহিংসতা)",
        re.I,
    ),
    "blockade": re.compile(
        r"\b(?:road\s+blockade|highway\s+blockade|rail\s+blockade|blockade[ds]?|"
        r"blocked\s+(?:the\s+)?(?:road|highway|intersection|street)|traffic\s+halt(?:ed)?|"
        r"barricade[ds]?|paralyz(?:ed|ing)\s+traffic)\b|"
        r"(?:সড়ক\s*অবরোধ|মহাসড়ক\s*অবরোধ|রেলপথ\s*অবরোধ|অবরোধ\s*করে|অবরোধের|"
        r"যান\s*চলাচল\s*বন্ধ|সড়ক\s*আটকে|ব্যারিকেড)",
        re.I,
    ),
    "strike": re.compile(
        r"\b(?:hartal|transport\s+strike|general\s+strike|indefinite\s+strike|"
        r"gherao(?:ed)?|work\s+abstention|countrywide\s+strike)\b|"
        r"(?:হরতাল|পরিবহন\s*ধর্মঘট|অনির্দিষ্টকালের\s*ধর্মঘট|ধর্মঘট|কর্মবিরতি|ঘেরাও)",
        re.I,
    ),
    "procession": re.compile(
        r"\b(?:protest\s+march|protest\s+procession|violent\s+protest|torch\s+procession|"
        r"blockade\s+march|siege\s+march)\b|"
        r"(?:বিক্ষোভ\s*মিছিল|মশাল\s*মিছিল|প্রতিবাদ\s*মিছিল|সড়কে\s*অবস্থান)",
        re.I,
    ),
    "accident": re.compile(
        r"\b(?:road\s+crash|road\s+accident|head-on\s+collision|bus\s+plunged|"
        r"train\s+derail(?:ed|ment)|run\s+over\s+by|launch\s+capsize[ds]?)\b|"
        r"(?:সড়ক\s*দুর্ঘটনা|মুখোমুখি\s*সংঘর্ষ|লরিচাপা|বাসচাপা|ট্রাকচাপা|রেল\s*দুর্ঘটনা|ট্রেন\s*লাইনচ্যুত|লঞ্চ\s*ডুবি)",
        re.I,
    ),
    "waterlogging": re.compile(
        r"\b(?:roads?\s+submerged|severe\s+waterlogging|knee[\s-]*deep\s+water|streets?\s+inundated)\b|"
        r"(?:সড়কে\s*জলাবদ্ধতা|পানিতে\s*তলিয়ে\s*গেছে|হাঁটুপানি|কোমরপানি)",
        re.I,
    ),
    "power_outage": re.compile(
        r"\b(?:national\s+grid\s+failure|massive\s+blackout|hours?\s+of\s+power\s+outage)\b|"
        r"(?:জাতীয়\s*গ্রিডে\s*বিপর্যয়|বিদ্যুৎ\s*বিচ্ছিন্ন|ভয়াবহ\s*লোডশেডিং)",
        re.I,
    ),
}

# Negative filter to reject non-threat routine news (e.g., grants, climate conferences, daily arrest summaries, court remands, sports, entertainment)
NON_THREAT_NOISE_RE = re.compile(
    r"\b(?:Global\s+Shield|COP3\d|ECNEC\s+approval|ANTALYA,\s*TURKEY|climate\s+insurance|"
    r"press\s+conference\s+at\s+the\s+Bangladesh\s+Pavilion|World\s+Cup|IPL|BPL|T20|"
    r"Gaza\s+Strip|West\s+Bank|Ukraine\s+war|James\s+Bond|Robert\s+Pattinson|Hollywood|Bollywood|"
    r"box\s+office|film\s+festival|put\s+on\s+.*?\s*remand|remand\s+granted|bail\s+rejected|"
    r"sent\s+to\s+jail)\b|"
    r"(?:ডিএমপির\s*অভিযানে\s*২৪\s*ঘণ্টায়\s*গ্রে[প্তফ]তার|নিয়মিত\s*অভিযানে\s*গত\s*২৪\s*ঘণ্টায়|"
    r"একনেক\s*সভায়|জলবায়ু\s*তহবিল|গাজায়\s*ইসরায়েলি|রিমান্ড\s*মঞ্জুর|দিনের\s*রিমান্ডে|"
    r"জামিন\s*নামঞ্জুর|কারাগারে\s*পাঠানো)",
    re.I,
)

# Bilingual Bangladesh / Dhaka Area Gazetteer with OpenStreetMap centroid coordinates (lat, lon)
AREA_METADATA: dict[str, dict] = {
    "Mirpur-10": {"lat": 23.8069, "lon": 90.3687, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*10\b|মিরপুর[\s-]*১০"},
    "Mirpur-11": {"lat": 23.8163, "lon": 90.3665, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*11\b|মিরপুর[\s-]*১১"},
    "Mirpur-12": {"lat": 23.8286, "lon": 90.3651, "city": "Dhaka", "pattern": r"\b(?:Mirpur[\s-]*12|Pallabi|Ceramics?\s+Road)\b|মিরপুর[\s-]*১২|পল্লবী|সিরামিক\s*রোড"},
    "Mirpur-1": {"lat": 23.7956, "lon": 90.3537, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*1\b(?!\d)|মিরপুর[\s-]*১(?!\d|[০-৯])"},
    "Mirpur-2": {"lat": 23.8042, "lon": 90.3576, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*2\b|মিরপুর[\s-]*২"},
    "Mirpur": {"lat": 23.8069, "lon": 90.3687, "city": "Dhaka", "pattern": r"\bMirpur\b(?![\s-]*\d)|মিরপুর(?![\s-]*[০-৯\d])"},
    "Kalshi": {"lat": 23.8221, "lon": 90.3774, "city": "Dhaka", "pattern": r"\bKalshi\b|কালশী"},
    "Motijheel": {"lat": 23.7330, "lon": 90.4172, "city": "Dhaka", "pattern": r"\bMotijheel\b|মতিঝিল"},
    "Shahbagh": {"lat": 23.7389, "lon": 90.3948, "city": "Dhaka", "pattern": r"\bShahbagh?\b|শাহবাগ"},
    "Uttara": {"lat": 23.8759, "lon": 90.3795, "city": "Dhaka", "pattern": r"\bUttara\b|উত্তরা"},
    "Abdullahpur": {"lat": 23.8805, "lon": 90.4002, "city": "Dhaka", "pattern": r"\bAbdullahpur\b|আব্দুল্লাহপুর"},
    "Airport": {"lat": 23.8513, "lon": 90.4089, "city": "Dhaka", "pattern": r"\b(?:Shahjalal\s+International\s+Airport|Airport\s+Road|Bimanbandar)\b|বিমানবন্দর"},
    "Kuril": {"lat": 23.8213, "lon": 90.4178, "city": "Dhaka", "pattern": r"\bKuril\b|কুড়িল|কুড়িল"},
    "Badda": {"lat": 23.7805, "lon": 90.4267, "city": "Dhaka", "pattern": r"\bBadda\b|বাড্ডা"},
    "Rampura": {"lat": 23.7612, "lon": 90.4214, "city": "Dhaka", "pattern": r"\b(?:Rampura|BTV\s+Bhaban)\b|রামপুরা|বিটিভি\s*ভবন"},
    "Malibagh": {"lat": 23.7495, "lon": 90.4128, "city": "Dhaka", "pattern": r"\bMalibagh?\b|মালিবাগ"},
    "Mouchak": {"lat": 23.7456, "lon": 90.4092, "city": "Dhaka", "pattern": r"\bMouchak\b|মৌচাক"},
    "Kakrail": {"lat": 23.7376, "lon": 90.4068, "city": "Dhaka", "pattern": r"\bKakrail\b|কাকরাইল"},
    "Paltan": {"lat": 23.7336, "lon": 90.4119, "city": "Dhaka", "pattern": r"\b(?:Paltan|Naya\s*Paltan)\b|পল্টন|নয়াপল্টন|নয়াপল্টন"},
    "Gulistan": {"lat": 23.7248, "lon": 90.4126, "city": "Dhaka", "pattern": r"\bGulistan\b|গুলিস্তান"},
    "Jatrabari": {"lat": 23.7104, "lon": 90.4349, "city": "Dhaka", "pattern": r"\b(?:Jatrabari|Shanir\s*Akhra|Dholaipar|Hanif\s+Flyover)\b|যাত্রাবাড়ী|যাত্রাবাড়ী|শনির\s*আখড়া|ধোলাইপাড়|হানিফ\s*ফ্লাইওভার"},
    "Sayedabad": {"lat": 23.7145, "lon": 90.4281, "city": "Dhaka", "pattern": r"\bSayedabad\b|সায়েদাবাদ|সায়েদাবাদ"},
    "Sadarghat": {"lat": 23.7061, "lon": 90.4084, "city": "Dhaka", "pattern": r"\bSadarghat\b|সদরঘাট"},
    "Old Dhaka": {"lat": 23.7160, "lon": 90.3958, "city": "Dhaka", "pattern": r"\b(?:Old\s+Dhaka|Lalbagh|Chawkbazar|Kotwali|Bahadur\s+Shah\s+Park)\b|পুরান\s*ঢাকা|লালবাগ|চকবাজার"},
    "Dhanmondi": {"lat": 23.7461, "lon": 90.3742, "city": "Dhaka", "pattern": r"\bDhanmondi\b|ধানমন্ডি"},
    "Science Lab": {"lat": 23.7393, "lon": 90.3834, "city": "Dhaka", "pattern": r"\bScience\s*Lab(?:oratory)?\b|সায়েন্সল্যাব|সায়েন্স\s*ল্যাব"},
    "New Market": {"lat": 23.7332, "lon": 90.3845, "city": "Dhaka", "pattern": r"\bNew\s*Market\b|নিউমার্কেট|নিউ\s*মার্কেট"},
    "Nilkhet": {"lat": 23.7319, "lon": 90.3869, "city": "Dhaka", "pattern": r"\bNilkhet\b|নীলক্ষেত"},
    "Azimpur": {"lat": 23.7275, "lon": 90.3856, "city": "Dhaka", "pattern": r"\bAzimpur\b|আজিমপুর"},
    "Mohammadpur": {"lat": 23.7662, "lon": 90.3589, "city": "Dhaka", "pattern": r"\b(?:Mohammadpur|Asad\s*Gate|Basila|Bosila|Krishi\s+Market|Shia\s+Mosque)\b|মোহাম্মদপুর|আসাদ\s*গেট|আসাদগেট|বসিলা|কৃষি\s*মার্কেট"},
    "Gabtoli": {"lat": 23.7837, "lon": 90.3442, "city": "Dhaka", "pattern": r"\bGabtoli\b|গাবতলী"},
    "Shyamoli": {"lat": 23.7748, "lon": 90.3652, "city": "Dhaka", "pattern": r"\bShyamoli\b|শ্যামলী"},
    "Agargaon": {"lat": 23.7776, "lon": 90.3805, "city": "Dhaka", "pattern": r"\bAgargaon\b|আগারগাঁও"},
    "Farmgate": {"lat": 23.7561, "lon": 90.3872, "city": "Dhaka", "pattern": r"\bFarmgate\b|ফার্মগেট"},
    "Karwan Bazar": {"lat": 23.7516, "lon": 90.3929, "city": "Dhaka", "pattern": r"\b(?:Karwan\s*Bazar|Kawran\s*Bazar)\b|কারওয়ান\s*বাজার|কারওয়ান\s*বাজার"},
    "Tejgaon": {"lat": 23.7619, "lon": 90.3987, "city": "Dhaka", "pattern": r"\bTejgaon\b|তেজগাঁও"},
    "Mohakhali": {"lat": 23.7778, "lon": 90.4052, "city": "Dhaka", "pattern": r"\b(?:Mohakhali|Titumir\s+College|Amtoli|Sattola)\b|মহাখালী|তিতুমীর\s*কলেজ|আমতলী|সাততলা"},
    "Banani": {"lat": 23.7940, "lon": 90.4043, "city": "Dhaka", "pattern": r"\b(?:Banani|Chairman\s*Bari|Kakoli)\b|বনানী|চেয়ারম্যান\s*বাড়ি|কাকলী"},
    "Gulshan": {"lat": 23.7925, "lon": 90.4158, "city": "Dhaka", "pattern": r"\bGulshan\b|গুলশান"},
    "Baridhara": {"lat": 23.8037, "lon": 90.4209, "city": "Dhaka", "pattern": r"\bBaridhara\b|বারিধারা"},
    "Bashundhara": {"lat": 23.8191, "lon": 90.4326, "city": "Dhaka", "pattern": r"\bBashundhara\b|বসুন্ধরা"},
    "Khilkhet": {"lat": 23.8305, "lon": 90.4192, "city": "Dhaka", "pattern": r"\bKhilkhet\b|খিলক্ষেত"},
    "Khilgaon": {"lat": 23.7508, "lon": 90.4275, "city": "Dhaka", "pattern": r"\bKhilgaon\b|খিলগাঁও"},
    "Mugda": {"lat": 23.7308, "lon": 90.4321, "city": "Dhaka", "pattern": r"\bMugda\b|মুগদা"},
    "Demra": {"lat": 23.7224, "lon": 90.4875, "city": "Dhaka", "pattern": r"\bDemra\b|ডেমরা"},
    "Keraniganj": {"lat": 23.6948, "lon": 90.3698, "city": "Dhaka", "pattern": r"\bKeraniganj\b|কেরানীগঞ্জ"},
    "Savar": {"lat": 23.8583, "lon": 90.2667, "city": "Dhaka", "pattern": r"\bSavar\b|সাভার"},
    "Ashulia": {"lat": 23.9010, "lon": 90.3245, "city": "Dhaka", "pattern": r"\bAshulia\b|আশুলিয়া|আশুলিয়া"},
    "Tongi": {"lat": 23.8973, "lon": 90.4026, "city": "Gazipur", "pattern": r"\bTongi\b|টঙ্গী"},
    "Gazipur": {"lat": 23.9999, "lon": 90.4203, "city": "Gazipur", "pattern": r"\bGazipur\b|গাজীপুর"},
    "Narayanganj": {"lat": 23.6238, "lon": 90.5000, "city": "Narayanganj", "pattern": r"\b(?:Narayanganj|N'ganj|N’ganj)\b|নারায়ণগঞ্জ|নারায়ণগঞ্জ"},
    "Chattogram": {"lat": 22.3569, "lon": 91.7832, "city": "Chattogram", "pattern": r"\b(?:Chattogram|Chittagong)\b|চট্টগ্রাম"},
    "Sylhet": {"lat": 24.8949, "lon": 91.8687, "city": "Sylhet", "pattern": r"\bSylhet\b|সিলেট"},
    "Rajshahi": {"lat": 24.3745, "lon": 88.6042, "city": "Rajshahi", "pattern": r"\bRajshahi\b|রাজশাহী"},
    "Khulna": {"lat": 22.8456, "lon": 89.5403, "city": "Khulna", "pattern": r"\bKhulna\b|খুলনা"},
    "Barishal": {"lat": 22.7010, "lon": 90.3535, "city": "Barishal", "pattern": r"\b(?:Barishal|Barisal)\b|বরিশাল"},
    "Rangpur": {"lat": 25.7439, "lon": 89.2752, "city": "Rangpur", "pattern": r"\bRangpur\b|রংপুর"},
    "Mymensingh": {"lat": 24.7471, "lon": 90.4203, "city": "Mymensingh", "pattern": r"\bMymensingh\b|ময়মনসিংহ|ময়মনসিংহ"},
    "Cumilla": {"lat": 23.4607, "lon": 91.1809, "city": "Cumilla", "pattern": r"\b(?:Cumilla|Comilla)\b|কুমিল্লা"},
    "Bogura": {"lat": 24.8481, "lon": 89.3730, "city": "Bogura", "pattern": r"\b(?:Bogura|Bogra)\b|বগুড়া|বগুড়া"},
    "Cox's Bazar": {"lat": 21.4272, "lon": 92.0058, "city": "Cox's Bazar", "pattern": r"\bCox['’]?s\s+Bazar\b|কক্সবাজার"},
}

AREA_GAZETTEER: list[tuple[str, re.Pattern]] = [
    (name, re.compile(meta["pattern"], re.I)) for name, meta in AREA_METADATA.items()
]

# Patterns to strip publisher footers, related links, police officer zone titles, and bus route origin/destination modifiers
FOOTER_CUT_RE = re.compile(
    r"(?:Publisher\s*:|Acting\s+Editor\s*:|Editor\s*:|সম্পাদক\s*:|প্রকাশক\s*:|বার্তা\s*ও\s*বাণিজ্যিক\s*কার্যালয়).*$",
    re.I | re.S,
)
RELATED_LINKS_RE = re.compile(
    r"(?:আরও\s*পড়ুন|আরও\s*পড়ুন|Also\s+Read|Read\s+More)[^\n।.]{0,180}",
    re.I,
)
POLICE_TITLE_RE = re.compile(
    r"(?:\b(?:assistant|additional|deputy)?\s*commissioner|\b(?:OC|ADC|DC|AC|SI|inspector)\b|"
    r"officer-in-charge)\s*(?:\([^)]*\))?\s*of\s+(?:the\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+"
    r"(?:zone|division|police\s+station)|"
    r"\b[A-Z][a-z]+\s+(?:Police\s+Station|zone\s+of\s+police)\s+(?:OC|inspector|officer)\b|"
    r"(?:গুলশান|বনানী|রমনা|তেজগাঁও|মিরপুর|মতিঝিল|ওয়ারী|লালবাগ|উত্তরা|বাড্ডা|পল্লবী|যাত্রাবাড়ী|যাত্রাবাড়ী|মোহাম্মদপুর|রামপুরা|শাহবাগ|ধানমন্ডি)\s*"
    r"(?:বিভাগের|জোনের|থানার)\s*(?:উপ-?পুলিশ\s*কমিশনার|উপকমিশনার|সহকারী\s*কমিশনার|অতিরিক্ত\s*উপ-?পুলিশ\s*কমিশনার|ভারপ্রাপ্ত\s*কর্মকর্তা|ওসি|পরিদর্শক|উপপরিদর্শক|এসআই)",
    re.I,
)
BUS_ROUTE_ORIGIN_RE = re.compile(
    r"(?:travelling|coming|heading|going)\s+from\s+[A-Z][a-z]+\s+(?:towards|to)\s+|"
    r"[ঁ-৯অ-হ]+গামী\s+(?:একটি\s+)?(?:বাস|পরিবহন|ট্রাক|লঞ্চ)|"
    r"(?:গুলশান|বনানী|যাত্রাবাড়ী|যাত্রাবাড়ী|মিরপুর|গাজীপুর|উত্তরা|মতিঝিল|সাভার|গাবতলী|সদরঘাট)\s+থেকে\s+[ঁ-৯অ-হ]+\s+(?:যাওয়ার|আসার)\s+পথে",
    re.I,
)
# Detects provincial / non-Dhaka headline anchor (e.g., ভাঙ্গায়, ডুমুরিয়ায়, ফরিদপুরে, সাঁথিয়ায়, পাবনায়) when Dhaka isn't in headline
OUTSIDE_DHAKA_HEADLINE_RE = re.compile(
    r"^(?:[ঁ-৯অ-হ]{3,14}(?:য়|য়ে|তে)\s+(?:বাসচাপায়|ট্রাকচাপায়|লরিচাপায়|সড়ক\s*দুর্ঘটনায়|সংঘর্ষে|হামলায়|ককটেলে|আগুনে)|"
    r"ভাঙ্গায়|ডুমুরিয়ায়|ফরিদপুরে|সাঁথিয়ায়|পাবনায়|সীতাকুণ্ডে|উখিয়ায়|টেকনাফে|নোয়াখালীতে|ফেনীতে|লক্ষ্মীপুরে|চাঁদপুরে|"
    r"ব্রাহ্মণবাড়িয়ায়|হবিগঞ্জে|মৌলভীবাজারে|সুনামগঞ্জে|কুষ্টিয়ায়|যশোরে|সাতক্ষীরায়|বাগেরহাটে|ঝিনাইদহে|"
    r"সিরাজগঞ্জে|নাটোরে|নওগাঁয়|চাঁপাইনবাবগঞ্জে|দিনাজপুরে|কুড়িগ্রামে|গাইবান্ধায়|লালমনিরহাটে|নীলফামারীতে|"
    r"পটুয়াখালীতে|ভোলায়|পিরোজপুরে|ঝালকাঠিতে|বরগুনায়|টাঙ্গাইলে|কিশোরগঞ্জে|নেত্রকোনায়|জামালপুরে|শেরপুরে|মাদারীপুরে|গোপালগঞ্জে|শরীয়তপুরে|রাজবাড়ীতে|মানিকগঞ্জে|মুন্সীগঞ্জে|নরসিংদীতে)\b"
)
GENERIC_DHAKA_HEADLINE_RE = re.compile(r"\b(?:Dhaka|capital)\b|রাজধানী|ঢাকা", re.I)

CLAUSE_SPLIT_RE = re.compile(
    r"[।.!?\n;]+|\b(?:while|meanwhile|whereas)\b|(?:অন্যদিকে|এছাড়া|অপরদিকে|এদিকে)",
    re.I,
)

TIME_WINDOW_RE = re.compile(
    r"\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)"
    r"(?:\s*(?:to|until|till|-|–)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))?)\b|"
    r"(?:(?:সকাল|দুপুর|বিকাল|বিকেল|সন্ধ্যা|রাত|ভোর)\s*[০-৯\d]{1,2}(?:টা|টার)?(?:\s*থেকে\s*[০-৯\d]{1,2}টা)?)",
    re.I,
)


def _clean_text_for_spatial_nlp(text: str) -> str:
    """Strips HTML tags, publisher footers, related links, police zone titles, and bus origin modifiers."""
    if not text:
        return ""
    cleaned = html.unescape(text)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = FOOTER_CUT_RE.sub(" ", cleaned)
    cleaned = RELATED_LINKS_RE.sub(" ", cleaned)
    cleaned = POLICE_TITLE_RE.sub(" ", cleaned)
    cleaned = BUS_ROUTE_ORIGIN_RE.sub(" ", cleaned)
    return cleaned


def _find_events(text: str) -> list[str]:
    return [ev for ev, pat in EVENT_TAXONOMY.items() if pat.search(text)]


def _find_locations(text: str) -> list[str]:
    found: list[str] = []
    for canonical, pat in AREA_GAZETTEER:
        if pat.search(text):
            found.append(canonical)
    # If a specific Mirpur section (e.g. Mirpur-10, Mirpur-11, Mirpur-12) matched, avoid redundant generic 'Mirpur'
    if any(k.startswith("Mirpur-") for k in found) and "Mirpur" in found:
        found.remove("Mirpur")
    return found


def extract_disruption_tags(headline: str, description: str, body: str) -> dict:
    """
    Context-Aware Bilingual Threat & Location Extractor.
    Returns:
      - event_types: list[str]
      - locations: list[str]
      - location_events: dict[str, list[str]]  (Exact mapping of which event happened at which location!)
      - time_windows: list[str]
      - is_disruption: bool
    """
    clean_head = _clean_text_for_spatial_nlp(headline)
    clean_desc = _clean_text_for_spatial_nlp(description)
    clean_body = _clean_text_for_spatial_nlp(body[:2500])

    primary_text = f"{clean_head}\n{clean_desc}"
    full_text = f"{clean_head}\n{clean_desc}\n{clean_body}"

    # 1. Non-threat noise rejection
    if NON_THREAT_NOISE_RE.search(primary_text):
        return {
            "event_types": [],
            "locations": [],
            "location_events": {},
            "time_windows": [],
            "is_disruption": False,
        }

    # 2. Threat Event Detection (must be present in headline or description)
    head_events = _find_events(primary_text)
    if not head_events and len(clean_desc.strip()) < 15:
        head_events = _find_events(f"{clean_head}\n{clean_body[:180]}")

    if not head_events:
        return {
            "event_types": [],
            "locations": [],
            "location_events": {},
            "time_windows": [],
            "is_disruption": False,
        }

    # 3. Context-Aware Location & Clause-Level (Location -> Event) Binding
    head_locs = _find_locations(clean_head)
    desc_locs = _find_locations(clean_desc)
    location_events: dict[str, list[str]] = {}

    # Rule A: If headline starts with an outside-Dhaka provincial town and doesn't mention Dhaka in headline,
    # do not allow body rollup paragraphs to assign it to Dhaka neighborhoods.
    if not head_locs and OUTSIDE_DHAKA_HEADLINE_RE.search(clean_head.strip()) and not GENERIC_DHAKA_HEADLINE_RE.search(clean_head):
        return {
            "event_types": head_events,
            "locations": [],
            "location_events": {},
            "time_windows": [],
            "is_disruption": False,
        }

    # Rule B: Headline Location Authority — If the headline explicitly names specific location(s),
    # lock the article's locations strictly to the headline locations!
    if head_locs:
        only_head_evs = _find_events(clean_head) or head_events
        for loc in head_locs:
            location_events[loc] = list(only_head_evs)
    else:
        # Rule C: Multi-location roundup or generic headline -> Clause-Level (Location, Event) Co-occurrence
        # Prioritize specific clauses (1 event type or <=2 locations) over lumped multi-event summary clauses
        clauses = CLAUSE_SPLIT_RE.split(full_text)
        specific_pairs: list[tuple[list[str], list[str]]] = []
        lumped_pairs: list[tuple[list[str], list[str]]] = []

        for clause in clauses:
            clause = clause.strip()
            if len(clause) < 12:
                continue
            c_locs = _find_locations(clause)
            if not c_locs:
                continue
            c_evs = _find_events(clause)
            if not c_evs:
                continue
            if len(c_evs) == 1 or len(c_locs) <= 2:
                specific_pairs.append((c_locs, c_evs))
            else:
                lumped_pairs.append((c_locs, c_evs))

        for c_locs, c_evs in specific_pairs:
            for loc in c_locs:
                existing = location_events.setdefault(loc, [])
                for ev in c_evs:
                    if ev not in existing:
                        existing.append(ev)

        # Only use lumped clauses if no specific clauses resolved any locations, and only if <=2 locations
        if not location_events:
            for c_locs, c_evs in lumped_pairs:
                if len(c_locs) <= 2:
                    for loc in c_locs:
                        existing = location_events.setdefault(loc, [])
                        for ev in c_evs:
                            if ev not in existing:
                                existing.append(ev)

        # Fallback: if description had specific locations (<=2) and headline had 1 specific event
        if not location_events and desc_locs and len(desc_locs) <= 2 and len(head_events) == 1:
            for loc in desc_locs:
                location_events[loc] = list(head_events)

    final_locs = list(location_events.keys())
    all_bound_events: list[str] = []
    for evs in location_events.values():
        for e in evs:
            if e not in all_bound_events:
                all_bound_events.append(e)
    final_events = all_bound_events or head_events

    times: list[str] = []
    for m in TIME_WINDOW_RE.finditer(full_text):
        val = m.group(0).strip()
        if val not in times:
            times.append(val)
        if len(times) >= 5:
            break

    return {
        "event_types": final_events,
        "locations": final_locs,
        "location_events": location_events,
        "time_windows": times,
        "is_disruption": bool(final_events and final_locs),
    }
