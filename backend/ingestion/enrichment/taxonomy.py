"""
Bilingual (English + Bangla) Disruption Event Taxonomy & Bangladesh Area Gazetteer.
Used by Stage 1 pre-tagging and Stage 3 Spark NLP enrichment.
"""
from __future__ import annotations

import re

# Bilingual event type taxonomy matching Stage 3 of the BigWarn Proposal PDF
EVENT_TAXONOMY: dict[str, re.Pattern] = {
    "blockade": re.compile(
        r"\b(?:blockade[ds]?|blocked|road\s+block|rail\s+blockade|traffic\s+halt(?:ed)?|"
        r"gridlock|stranded|barricade[ds]?)\b|"
        r"(?:অবরোধ|সড়ক\s*অবরোধ|মহাসড়ক\s*অবরোধ|যান\s*চলাচল\s*বন্ধ|যানজট|অচল|রেলপথ\s*অবরোধ)",
        re.I,
    ),
    "strike": re.compile(
        r"\b(?:hartal|strike[ds]?|walkout|work\s+abstention|shut\s*down|factory\s+shut|"
        r"factories\s+shut|declare[ds]?\s+holiday)\b|"
        r"(?:হরতাল|ধর্মঘট|কর্মবিরতি|কারখানা\s*বন্ধ|ছুটি\s*ঘোষণা)",
        re.I,
    ),
    "procession": re.compile(
        r"\b(?:procession|protest(?:s|ed|ing|ers)?|demonstrat(?:ion|ors|ed)|rally|rallies|"
        r"march(?:ed|ing)?|sit-in|human\s+chain|gherao|unrest|agitation)\b|"
        r"(?:বিক্ষোভ|মিছিল|মানববন্ধন|ঘেরাও|আন্দোলন|সমাবেশ|অবস্থান\s*কর্মসূচি)",
        re.I,
    ),
    "clash": re.compile(
        r"\b(?:clash(?:es|ed)?|chase[ds]?|brickbat[s]?|tear\s*gas|sound\s+grenade|"
        r"baton\s+charge|vandal(?:ism|ised|ized)|arson|torch(?:ed)?|beaten)\b|"
        r"(?:সংঘর্ষ|ধাওয়া|পাল্টা\s*ধাওয়া|ইটপাটকেল|টিয়ার\s*শেল|টিয়ারশেল|সাউন্ড\s*গ্রেনেড|ভাঙচুর|লাঠিচার্জ)",
        re.I,
    ),
    "fire": re.compile(
        r"\b(?:fire\s+breaks?\s+out|caught\s+fire|gutted\s+by\s+fire|blaze|fire\s+service|"
        r"set\s+on\s+fire|inferno|burn(?:ed|t)\s+down)\b|"
        r"(?:আগুন|অগ্নিকাণ্ড|ভস্মীভূত|ফায়ার\s*সার্ভিস|দগ্ধ)",
        re.I,
    ),
    "waterlogging": re.compile(
        r"\b(?:waterlogging|waterlogged|inundat(?:ed|ion)|flash\s+flood|flood(?:s|ed|ing)?|"
        r"submerged|heavy\s+downpour)\b|"
        r"(?:জলাবদ্ধতা|বন্যা|প্লাবিত|তলিয়ে|ভারী\s*বর্ষণ)",
        re.I,
    ),
    "accident": re.compile(
        r"\b(?:road\s+crash|road\s+accident|head-on\s+collision|overturned|derail(?:ed|ment)|"
        r"run\s+over|capsize[ds]?)\b|"
        r"(?:সড়ক\s*দুর্ঘটনা|দুর্ঘটনা|মুখোমুখি\s*সংঘর্ষ|লরিচাপা|বাসচাপা|ট্রাকচাপা|রেল\s*দুর্ঘটনা|লঞ্চ\s*ডুবি)",
        re.I,
    ),
    "power_outage": re.compile(
        r"\b(?:power\s+outage|load\s*shedding|blackout|grid\s+failure|gas\s+shortage|"
        r"power\s+cut)\b|"
        r"(?:লোডশেডিং|বিদ্যুৎ\s*বিচ্ছিন্ন|বিদ্যুৎ\s*সংকট|গ্যাস\s*সংকট)",
        re.I,
    ),
}

# Bilingual Bangladesh / Dhaka Area Gazetteer with OpenStreetMap centroid coordinates (lat, lon)
AREA_METADATA: dict[str, dict] = {
    "Mirpur-10": {"lat": 23.8069, "lon": 90.3687, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*10\b|মিরপুর[\s-]*১০"},
    "Mirpur-11": {"lat": 23.8163, "lon": 90.3665, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*11\b|মিরপুর[\s-]*১১"},
    "Mirpur-12": {"lat": 23.8286, "lon": 90.3651, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*12\b|মিরপুর[\s-]*১২"},
    "Mirpur-1": {"lat": 23.7956, "lon": 90.3537, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*1\b(?!\d)|মিরপুর[\s-]*১(?!\d|[০-৯])"},
    "Mirpur-2": {"lat": 23.8042, "lon": 90.3576, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*2\b|মিরপুর[\s-]*২"},
    "Mirpur": {"lat": 23.8069, "lon": 90.3687, "city": "Dhaka", "pattern": r"\bMirpur\b|মিরপুর"},
    "Kalshi": {"lat": 23.8221, "lon": 90.3774, "city": "Dhaka", "pattern": r"\bKalshi\b|কালশী"},
    "Motijheel": {"lat": 23.7330, "lon": 90.4172, "city": "Dhaka", "pattern": r"\bMotijheel\b|মতিঝিল"},
    "Shahbagh": {"lat": 23.7389, "lon": 90.3948, "city": "Dhaka", "pattern": r"\bShahbagh?\b|শাহবাগ"},
    "Uttara": {"lat": 23.8759, "lon": 90.3795, "city": "Dhaka", "pattern": r"\bUttara\b|উত্তরা"},
    "Abdullahpur": {"lat": 23.8805, "lon": 90.4002, "city": "Dhaka", "pattern": r"\bAbdullahpur\b|আব্দুল্লাহপুর"},
    "Airport": {"lat": 23.8513, "lon": 90.4089, "city": "Dhaka", "pattern": r"\b(?:Shahjalal\s+International\s+Airport|Airport\s+Road|Bimanbandar)\b|বিমানবন্দর"},
    "Kuril": {"lat": 23.8213, "lon": 90.4178, "city": "Dhaka", "pattern": r"\bKuril\b|কুড়িল|কুড়িল"},
    "Badda": {"lat": 23.7805, "lon": 90.4267, "city": "Dhaka", "pattern": r"\bBadda\b|বাড্ডা"},
    "Rampura": {"lat": 23.7612, "lon": 90.4214, "city": "Dhaka", "pattern": r"\bRampura\b|রামপুরা"},
    "Malibagh": {"lat": 23.7495, "lon": 90.4128, "city": "Dhaka", "pattern": r"\bMalibagh?\b|মালিবাগ"},
    "Mouchak": {"lat": 23.7456, "lon": 90.4092, "city": "Dhaka", "pattern": r"\bMouchak\b|মৌচাক"},
    "Kakrail": {"lat": 23.7376, "lon": 90.4068, "city": "Dhaka", "pattern": r"\bKakrail\b|কাকরাইল"},
    "Paltan": {"lat": 23.7336, "lon": 90.4119, "city": "Dhaka", "pattern": r"\b(?:Paltan|Naya\s*Paltan)\b|পল্টন|নয়াপল্টন"},
    "Gulistan": {"lat": 23.7248, "lon": 90.4126, "city": "Dhaka", "pattern": r"\bGulistan\b|গুলিস্তান"},
    "Jatrabari": {"lat": 23.7104, "lon": 90.4349, "city": "Dhaka", "pattern": r"\bJatrabari\b|যাত্রাবাড়ী|যাত্রাবাড়ী"},
    "Sayedabad": {"lat": 23.7145, "lon": 90.4281, "city": "Dhaka", "pattern": r"\bSayedabad\b|সায়েদাবাদ"},
    "Sadarghat": {"lat": 23.7061, "lon": 90.4084, "city": "Dhaka", "pattern": r"\bSadarghat\b|সদরঘাট"},
    "Old Dhaka": {"lat": 23.7160, "lon": 90.3958, "city": "Dhaka", "pattern": r"\b(?:Old\s+Dhaka|Lalbagh|Chawkbazar|Kotwali|Bahadur\s+Shah\s+Park)\b|পুরান\s*ঢাকা|লালবাগ|চকবাজার"},
    "Dhanmondi": {"lat": 23.7461, "lon": 90.3742, "city": "Dhaka", "pattern": r"\bDhanmondi\b|ধানমন্ডি"},
    "Science Lab": {"lat": 23.7393, "lon": 90.3834, "city": "Dhaka", "pattern": r"\bScience\s*Lab(?:oratory)?\b|সায়েন্সল্যাব|সায়েন্স\s*ল্যাব"},
    "New Market": {"lat": 23.7332, "lon": 90.3845, "city": "Dhaka", "pattern": r"\bNew\s*Market\b|নিউমার্কেট|নিউ\s*মার্কেট"},
    "Nilkhet": {"lat": 23.7319, "lon": 90.3869, "city": "Dhaka", "pattern": r"\bNilkhet\b|নীলক্ষেত"},
    "Azimpur": {"lat": 23.7275, "lon": 90.3856, "city": "Dhaka", "pattern": r"\bAzimpur\b|আজিমপুর"},
    "Mohammadpur": {"lat": 23.7662, "lon": 90.3589, "city": "Dhaka", "pattern": r"\bMohammadpur\b|মোহাম্মদপুর"},
    "Gabtoli": {"lat": 23.7837, "lon": 90.3442, "city": "Dhaka", "pattern": r"\bGabtoli\b|গাবতলী"},
    "Shyamoli": {"lat": 23.7748, "lon": 90.3652, "city": "Dhaka", "pattern": r"\bShyamoli\b|শ্যামলী"},
    "Agargaon": {"lat": 23.7776, "lon": 90.3805, "city": "Dhaka", "pattern": r"\bAgargaon\b|আগারগাঁও"},
    "Farmgate": {"lat": 23.7561, "lon": 90.3872, "city": "Dhaka", "pattern": r"\bFarmgate\b|ফার্মগেট"},
    "Karwan Bazar": {"lat": 23.7516, "lon": 90.3929, "city": "Dhaka", "pattern": r"\b(?:Karwan\s*Bazar|Kawran\s*Bazar)\b|কারওয়ান\s*বাজার|কারওয়ান\s*বাজার"},
    "Tejgaon": {"lat": 23.7619, "lon": 90.3987, "city": "Dhaka", "pattern": r"\bTejgaon\b|তেজগাঁও"},
    "Mohakhali": {"lat": 23.7778, "lon": 90.4052, "city": "Dhaka", "pattern": r"\bMohakhali\b|মহাখালী"},
    "Banani": {"lat": 23.7940, "lon": 90.4043, "city": "Dhaka", "pattern": r"\bBanani\b|বনানী"},
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

TIME_WINDOW_RE = re.compile(
    r"\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)"
    r"(?:\s*(?:to|until|till|-|–)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))?)\b|"
    r"(?:(?:সকাল|দুপুর|বিকাল|বিকেল|সন্ধ্যা|রাত|ভোর)\s*[০-৯\d]{1,2}(?:টা|টার)?(?:\s*থেকে\s*[০-৯\d]{1,2}টা)?)",
    re.I,
)


def extract_disruption_tags(headline: str, description: str, body: str) -> dict:
    """Extracts event_types, locations, coordinates, and time_windows for Spark & Mobile Edge filtering."""
    primary_text = f"{headline}\n{description}"
    full_text = f"{headline}\n{description}\n{body[:3000]}"

    events = [ev for ev, pat in EVENT_TAXONOMY.items() if pat.search(primary_text)]
    if not events and body:
        lead = f"{headline}\n{body[:800]}"
        events = [ev for ev, pat in EVENT_TAXONOMY.items() if pat.search(lead)]

    locs = []
    for canonical, pat in AREA_GAZETTEER:
        if pat.search(full_text):
            locs.append(canonical)

    times = []
    for m in TIME_WINDOW_RE.finditer(full_text):
        val = m.group(0).strip()
        if val not in times:
            times.append(val)
        if len(times) >= 5:
            break

    return {
        "event_types": events,
        "locations": locs,
        "time_windows": times,
        "is_disruption": bool(events),
    }

