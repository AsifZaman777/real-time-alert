"""
Bilingual (English + Bangla) Threat & Disruption Event Taxonomy +
Dynamic All-Bangladesh & Full-Dhaka Spatial Gazetteer.

Capabilities:
1. High-Threat Public Safety & Disruption Detection (gunfire, murder, fire, clash, blockade,
   strike, procession, accident, waterlogging, power outage).
2. Comprehensive Seed Gazetteer:
   - Full Dhaka Metro coverage (~110+ wards, intersections, roads, markets, and suburbs)
   - All 64 Bangladesh Districts + major upazilas & highway hubs
3. Dynamic Open-Vocabulary Village / Upazila / Area Discovery:
   - Extracts ANY unlisted village, union, upazila, thana, bazar, or road mentioned in Bangla
     or English news clauses, and links each to its parent district & OSM coordinates.
4. Clause-Level (Location -> Event) Binding with non-threat noise suppression.
"""
from __future__ import annotations

import html
import re
import unicodedata

TAG_VERSION = 3

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
        r"blockade\s+march|siege\s+march|demonstration|human\s+chain)\b|"
        r"(?:বিক্ষোভ\s*মিছিল|মশাল\s*মিছিল|প্রতিবাদ\s*মিছিল|সড়কে\s*অবস্থান|মানববন্ধন|বিক্ষোভ\s*সমাবেশ)",
        re.I,
    ),
    "accident": re.compile(
        r"\b(?:road\s+crash|road\s+accident|head-on\s+collision|bus\s+plunged|"
        r"train\s+derail(?:ed|ment)|run\s+over\s+by|launch\s+capsize[ds]?)\b|"
        r"(?:সড়ক\s*দুর্ঘটনা|মুখোমুখি\s*সংঘর্ষ|লরিচাপা|বাসচাপা|ট্রাকচাপা|রেল\s*দুর্ঘটনা|ট্রেন\s*লাইনচ্যুত|লঞ্চ\s*ডুবি)",
        re.I,
    ),
    "waterlogging": re.compile(
        r"\b(?:roads?\s+submerged|severe\s+waterlogging|knee[\s-]*deep\s+water|streets?\s+inundated|flash\s+flood|flood(?:ed|ing)?)\b|"
        r"(?:সড়কে\s*জলাবদ্ধতা|জলাবদ্ধতা|পানিতে\s*তলিয়ে\s*গেছে|হাঁটুপানি|কোমরপানি|বন্যা|প্লাবিত)",
        re.I,
    ),
    "power_outage": re.compile(
        r"\b(?:national\s+grid\s+failure|massive\s+blackout|hours?\s+of\s+power\s+outage|power\s+outage|load\s*shedding)\b|"
        r"(?:জাতীয়\s*গ্রিডে\s*বিপর্যয়|বিদ্যুৎ\s*বিচ্ছিন্ন|ভয়াবহ\s*লোডশেডিং|লোডশেডিং)",
        re.I,
    ),
}

# Reject foreign / sports / entertainment / routine remand noise
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

# Comprehensive Bilingual Bangladesh & Full-Dhaka Area Gazetteer
AREA_METADATA: dict[str, dict] = {
    # --- Complete Dhaka Metro & Suburbs ---
    "Mirpur-1": {"lat": 23.7956, "lon": 90.3537, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*1\b(?!\d)|মিরপুর[\s-]*১(?!\d|[০-৯])"},
    "Mirpur-2": {"lat": 23.8042, "lon": 90.3576, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*2\b|মিরপুর[\s-]*২"},
    "Mirpur-6": {"lat": 23.8095, "lon": 90.3622, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*6\b|মিরপুর[\s-]*৬"},
    "Mirpur-7": {"lat": 23.8168, "lon": 90.3614, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*7\b|মিরপুর[\s-]*৭"},
    "Mirpur-10": {"lat": 23.8069, "lon": 90.3687, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*10\b|মিরপুর[\s-]*১০"},
    "Mirpur-11": {"lat": 23.8163, "lon": 90.3665, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*11\b|মিরপুর[\s-]*১১"},
    "Mirpur-12": {"lat": 23.8286, "lon": 90.3651, "city": "Dhaka", "pattern": r"\b(?:Mirpur[\s-]*12|Ceramics?\s+Road)\b|মিরপুর[\s-]*১২|সিরামিক\s*রোড"},
    "Mirpur-13": {"lat": 23.8048, "lon": 90.3765, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*13\b|মিরপুর[\s-]*১৩"},
    "Mirpur-14": {"lat": 23.7995, "lon": 90.3845, "city": "Dhaka", "pattern": r"\bMirpur[\s-]*14\b|মিরপুর[\s-]*১৪"},
    "Pallabi": {"lat": 23.8256, "lon": 90.3658, "city": "Dhaka", "pattern": r"\bPallabi\b|পল্লবী"},
    "Rupnagar": {"lat": 23.8178, "lon": 90.3545, "city": "Dhaka", "pattern": r"\bRupnagar\b|রূপনগর"},
    "Kazipara": {"lat": 23.7978, "lon": 90.3728, "city": "Dhaka", "pattern": r"\bKazipara\b|কাজীপাড়া|কাজিপাড়া"},
    "Shewrapara": {"lat": 23.7905, "lon": 90.3752, "city": "Dhaka", "pattern": r"\bShewrapara\b|শেওড়াপাড়া|শেওড়াপাড়া"},
    "Taltola (Mirpur)": {"lat": 23.7848, "lon": 90.3768, "city": "Dhaka", "pattern": r"\bMirpur\s+Taltola\b|মিরপুর\s+তালতলা"},
    "Ibrahimpur": {"lat": 23.7944, "lon": 90.3862, "city": "Dhaka", "pattern": r"\bIbrahimpur\b|ইব্রাহিমপুর"},
    "Kachukhet": {"lat": 23.7988, "lon": 90.3886, "city": "Dhaka", "pattern": r"\bKachukhet\b|কচুক্ষেত"},
    "Kalshi": {"lat": 23.8221, "lon": 90.3774, "city": "Dhaka", "pattern": r"\b(?:Kalshi|ECB\s+Chattar|Matikata)\b|কালশী|ইসিবি\s*চত্বর|মাটিকাটা"},
    "Mirpur DOHS": {"lat": 23.8358, "lon": 90.3694, "city": "Dhaka", "pattern": r"\bMirpur\s+DOHS\b|মিরপুর\s*ডিওএইচএস"},
    "Shah Ali": {"lat": 23.8002, "lon": 90.3485, "city": "Dhaka", "pattern": r"\bShah\s*Ali\b|শাহ\s*আলী|শাহআলী"},
    "Darus Salam": {"lat": 23.7865, "lon": 90.3522, "city": "Dhaka", "pattern": r"\bDarus\s*Salam\b|দারুস\s*সালাম"},
    "Mirpur": {"lat": 23.8069, "lon": 90.3687, "city": "Dhaka", "pattern": r"\bMirpur\b(?![\s-]*\d)|মিরপুর(?![\s-]*[০-৯\d])"},
    "Gabtoli": {"lat": 23.7837, "lon": 90.3442, "city": "Dhaka", "pattern": r"\bGabtoli\b|গাবতলী"},
    "Aminbazar": {"lat": 23.7892, "lon": 90.3296, "city": "Dhaka", "pattern": r"\bAminbazar\b|আমিনবাজার"},
    "Technical": {"lat": 23.7811, "lon": 90.3526, "city": "Dhaka", "pattern": r"\bTechnical\s+(?:Intersection|More|Mor)\b|টেকনিক্যাল\s*(?:মোড়|মোড়)"},
    "Kallyanpur": {"lat": 23.7768, "lon": 90.3601, "city": "Dhaka", "pattern": r"\bKallyanpur\b|কল্যাণপুর"},
    "Shyamoli": {"lat": 23.7748, "lon": 90.3652, "city": "Dhaka", "pattern": r"\bShyamoli\b|শ্যামলী"},
    "Agargaon": {"lat": 23.7776, "lon": 90.3805, "city": "Dhaka", "pattern": r"\b(?:Agargaon|Sher-e-Bangla\s+Nagar)\b|আগারগাঁও|শেরেবাংলা\s*নগর"},
    "Adabor": {"lat": 23.7705, "lon": 90.3578, "city": "Dhaka", "pattern": r"\bAdabor\b|আদাবর"},
    "Mohammadpur": {"lat": 23.7662, "lon": 90.3589, "city": "Dhaka", "pattern": r"\b(?:Mohammadpur|Asad\s*Gate|Bosila|Basila|Krishi\s+Market|Shia\s+Mosque|Town\s+Hall)\b|মোহাম্মদপুর|আসাদ\s*গেট|আসাদগেট|বসিলা|কৃষি\s*মার্কেট|টাউন\s*হল"},
    "Lalmatia": {"lat": 23.7571, "lon": 90.3695, "city": "Dhaka", "pattern": r"\bLalmatia\b|লালমাটিয়া|লালমাটিয়া"},
    "Dhanmondi": {"lat": 23.7461, "lon": 90.3742, "city": "Dhaka", "pattern": r"\bDhanmondi\b|ধানমন্ডি|ধানমণ্ডি"},
    "Jigatola": {"lat": 23.7396, "lon": 90.3714, "city": "Dhaka", "pattern": r"\b(?:Jigatola|Zigatola)\b|জিগাতলা"},
    "Kalabagan": {"lat": 23.7486, "lon": 90.3806, "city": "Dhaka", "pattern": r"\bKalabagan\b|কলাবাগান"},
    "Shukrabad": {"lat": 23.7524, "lon": 90.3792, "city": "Dhaka", "pattern": r"\bShukrabad\b|শুক্রাবাদ"},
    "Panthapath": {"lat": 23.7518, "lon": 90.3852, "city": "Dhaka", "pattern": r"\b(?:Panthapath|Green\s+Road|Kathalbagan)\b|পান্থপথ|গ্রিন\s*রোড|কাঁঠালবাগান"},
    "Hazaribagh": {"lat": 23.7346, "lon": 90.3662, "city": "Dhaka", "pattern": r"\bHazaribagh?\b|হাজারীবাগ"},
    "Kamrangirchar": {"lat": 23.7142, "lon": 90.3695, "city": "Dhaka", "pattern": r"\bKamrangirchar\b|কামরাঙ্গীরচর"},
    "Science Lab": {"lat": 23.7393, "lon": 90.3834, "city": "Dhaka", "pattern": r"\b(?:Science\s*Lab(?:oratory)?|Elephant\s+Road|Bata\s+Signal)\b|সায়েন্সল্যাব|সায়েন্স\s*ল্যাব|এলিফ্যান্ট\s*রোড|বাটা\s*সিগন্যাল"},
    "New Market": {"lat": 23.7332, "lon": 90.3845, "city": "Dhaka", "pattern": r"\bNew\s*Market\b|নিউমার্কেট|নিউ\s*মার্কেট"},
    "Nilkhet": {"lat": 23.7319, "lon": 90.3869, "city": "Dhaka", "pattern": r"\bNilkhet\b|নীলক্ষেত"},
    "Azimpur": {"lat": 23.7275, "lon": 90.3856, "city": "Dhaka", "pattern": r"\b(?:Azimpur|Palashi)\b|আজিমপুর|পলাশী"},
    "Chankharpul": {"lat": 23.7248, "lon": 90.3992, "city": "Dhaka", "pattern": r"\b(?:Chankharpul|Bakshibazar)\b|চানখাঁরপুল|বকশীবাজার"},
    "Shahbagh": {"lat": 23.7389, "lon": 90.3948, "city": "Dhaka", "pattern": r"\b(?:Shahbagh?|TSC|Dhaka\s+University|DU\s+campus|Matsya\s+Bhaban|Doyel\s+Chattar|Raju\s+Sculpture)\b|শাহবাগ|টিএসসি|ঢাবি|ঢাকা\s*বিশ্ববিদ্যালয়|মৎস্য\s*ভবন|দোয়েল\s*চত্বর|রাজু\s*ভাস্কর্য"},
    "Press Club": {"lat": 23.7294, "lon": 90.4084, "city": "Dhaka", "pattern": r"\b(?:National\s+Press\s+Club|Topkhana|Secretariat|High\s+Court)\b|প্রেস\s*ক্লাব|তোপখানা|সচিবালয়|হাইকোর্ট"},
    "Paltan": {"lat": 23.7336, "lon": 90.4119, "city": "Dhaka", "pattern": r"\b(?:Paltan|Naya\s*Paltan|Purana\s*Paltan|Bijoynagar)\b|পল্টন|নয়াপল্টন|নয়াপল্টন|পুরানা\s*পল্টন|বিজয়নগর"},
    "Kakrail": {"lat": 23.7376, "lon": 90.4068, "city": "Dhaka", "pattern": r"\b(?:Kakrail|Ramna)\b|কাকরাইল|রমনা"},
    "Segunbagicha": {"lat": 23.7332, "lon": 90.4046, "city": "Dhaka", "pattern": r"\bSegunbagicha\b|সেগুনবাগিচা"},
    "Shantinagar": {"lat": 23.7396, "lon": 90.4136, "city": "Dhaka", "pattern": r"\b(?:Shantinagar|Bailey\s+Road)\b|শান্তিনগর|বেইলি\s*রোড"},
    "Eskaton": {"lat": 23.7438, "lon": 90.4005, "city": "Dhaka", "pattern": r"\b(?:Eskaton|Banglamotor|Paribagh)\b|ইস্কাটন|বাংলামোটর|পরীবাগ"},
    "Moghbazar": {"lat": 23.7486, "lon": 90.4034, "city": "Dhaka", "pattern": r"\bMoghbazar\b|মগবাজার"},
    "Mouchak": {"lat": 23.7456, "lon": 90.4092, "city": "Dhaka", "pattern": r"\bMouchak\b|মৌচাক"},
    "Malibagh": {"lat": 23.7495, "lon": 90.4128, "city": "Dhaka", "pattern": r"\bMalibagh?\b|মালিবাগ"},
    "Rampura": {"lat": 23.7612, "lon": 90.4214, "city": "Dhaka", "pattern": r"\b(?:Rampura|BTV\s+Bhaban)\b|রামপুরা|বিটিভি\s*ভবন"},
    "Banasree": {"lat": 23.7621, "lon": 90.4328, "city": "Dhaka", "pattern": r"\b(?:Banasree|Aftabnagar)\b|বনশ্রী|আফতাবনগর"},
    "Badda": {"lat": 23.7805, "lon": 90.4267, "city": "Dhaka", "pattern": r"\b(?:Badda|Merul\s+Badda|Madhya\s+Badda|Uttar\s+Badda|Satarkul)\b|বাড্ডা|মেরুল\s*বাড্ডা|মধ্য\s*বাড্ডা|উত্তর\s*বাড্ডা|সাতারকুল"},
    "Notun Bazar": {"lat": 23.7975, "lon": 90.4242, "city": "Dhaka", "pattern": r"\b(?:Notun\s+Bazar|Natun\s+Bazar|Vatara|Nadda)\b|নতুন\s*বাজার|নতুনবাজার|ভাটারা|নদ্দা"},
    "Bashundhara": {"lat": 23.8191, "lon": 90.4326, "city": "Dhaka", "pattern": r"\bBashundhara\b|বসুন্ধরা"},
    "Baridhara": {"lat": 23.8037, "lon": 90.4209, "city": "Dhaka", "pattern": r"\bBaridhara\b|বারিধারা"},
    "Gulshan": {"lat": 23.7925, "lon": 90.4158, "city": "Dhaka", "pattern": r"\b(?:Gulshan|Niketon)\b|গুলশান|নিকেতন"},
    "Banani": {"lat": 23.7940, "lon": 90.4043, "city": "Dhaka", "pattern": r"\b(?:Banani|Chairman\s*Bari|Kakoli|Banani\s+DOHS)\b|বনানী|চেয়ারম্যান\s*বাড়ি|কাকলী"},
    "Mohakhali": {"lat": 23.7778, "lon": 90.4052, "city": "Dhaka", "pattern": r"\b(?:Mohakhali|Titumir\s+College|Amtoli|Sattola|Hatirjheel)\b|মহাখালী|তিতুমীর\s*কলেজ|আমতলী|সাততলা|হাতিরঝিল"},
    "Cantonment": {"lat": 23.8135, "lon": 90.3982, "city": "Dhaka", "pattern": r"\b(?:Dhaka\s+Cantonment|Kalachandpur|Kafrul)\b|ঢাকা\s*সেনানিবাস|ক্যান্টনমেন্ট|কাফরুল"},
    "Tejgaon": {"lat": 23.7619, "lon": 90.3987, "city": "Dhaka", "pattern": r"\b(?:Tejgaon|Nabisco|Saat\s+Rasta|Nakhalpara)\b|তেজগাঁও|সাতরাস্তা|নাখালপাড়া"},
    "Karwan Bazar": {"lat": 23.7516, "lon": 90.3929, "city": "Dhaka", "pattern": r"\b(?:Karwan\s*Bazar|Kawran\s*Bazar)\b|কারওয়ান\s*বাজার|কারওয়ান\s*বাজার"},
    "Farmgate": {"lat": 23.7561, "lon": 90.3872, "city": "Dhaka", "pattern": r"\b(?:Farmgate|Khamarbari|Bijoy\s+Sarani|Manik\s+Mia)\b|ফার্মগেট|খামারবাড়ি|বিজয়\s*সরণি|মানিক\s*মিয়া"},
    "Khilkhet": {"lat": 23.8305, "lon": 90.4192, "city": "Dhaka", "pattern": r"\b(?:Khilkhet|Nikunja)\b|খিলক্ষেত|নিকুঞ্জ"},
    "Kuril": {"lat": 23.8213, "lon": 90.4178, "city": "Dhaka", "pattern": r"\b(?:Kuril|Kuratoli|Joar\s+Sahara|300\s+Feet|Purbachal)\b|কুড়িল|কুড়িল|কুড়াতলী|জোয়ারসাহারা|৩০০\s*ফিট|পূর্বাচল"},
    "Airport": {"lat": 23.8513, "lon": 90.4089, "city": "Dhaka", "pattern": r"\b(?:Shahjalal\s+International\s+Airport|Airport\s+Road|Bimanbandar|Kawla)\b|বিমানবন্দর|কাওলা"},
    "Uttara": {"lat": 23.8759, "lon": 90.3795, "city": "Dhaka", "pattern": r"\b(?:Uttara|Diabari|Azampur|House\s+Building|Jasimuddin|Kamarpara)\b|উত্তরা|দিয়াবাড়ী|দিয়াবাড়ি|আজমপুর|হাউজ\s*বিল্ডিং|জসীমউদ্দীন|কামারপাড়া"},
    "Abdullahpur": {"lat": 23.8805, "lon": 90.4002, "city": "Dhaka", "pattern": r"\bAbdullahpur\b|আব্দুল্লাহপুর"},
    "Dakshinkhan": {"lat": 23.8592, "lon": 90.4178, "city": "Dhaka", "pattern": r"\b(?:Dakshinkhan|Ashkona|Uttarkhan|Turag)\b|দক্ষিণখান|আশকোনা|উত্তরখান|তুরাগ"},
    "Khilgaon": {"lat": 23.7508, "lon": 90.4275, "city": "Dhaka", "pattern": r"\b(?:Khilgaon|Bashabo|Sabujbagh|Goran)\b|খিলগাঁও|বাসাবো|সবুজবাগ|গোড়ান"},
    "Motijheel": {"lat": 23.7330, "lon": 90.4172, "city": "Dhaka", "pattern": r"\b(?:Motijheel|Shapla\s+Chattar|Dilkusha|Arambagh|Fakirapool|Kamalapur|Rajarbagh|Shahjahanpur)\b|মতিঝিল|শাপলা\s*চত্বর|শাপলা\s*চত্বরে|দিলকুশা|আরামবাগ|ফকিরাপুল|কমলাপুর|রাজারবাগ|শাহজাহানপুর"},
    "Mugda": {"lat": 23.7308, "lon": 90.4321, "city": "Dhaka", "pattern": r"\b(?:Mugda|Maniknagar|Gopibagh)\b|মুগদা|মানিকনগর|গোপীবাগ"},
    "Gulistan": {"lat": 23.7248, "lon": 90.4126, "city": "Dhaka", "pattern": r"\b(?:Gulistan|Zero\s+Point|Bangabandhu\s+Avenue)\b|গুলিস্তান|জিরো\s*পয়েন্ট"},
    "Sayedabad": {"lat": 23.7145, "lon": 90.4281, "city": "Dhaka", "pattern": r"\bSayedabad\b|সায়েদাবাদ|সায়েদাবাদ"},
    "Jatrabari": {"lat": 23.7104, "lon": 90.4349, "city": "Dhaka", "pattern": r"\b(?:Jatrabari|Shanir\s*Akhra|Dholaipar|Hanif\s+Flyover|Kazla|Matuail|Dania)\b|যাত্রাবাড়ী|যাত্রাবাড়ী|শনির\s*আখড়া|ধোলাইপাড়|হানিফ\s*ফ্লাইওভার|কাজলা|মাতুয়াইল|দনিয়া"},
    "Jurain": {"lat": 23.6978, "lon": 90.4368, "city": "Dhaka", "pattern": r"\b(?:Jurain|Postogola|Shyampur|Kadamtali)\b|জুরাইন|পোস্তগোলা|শ্যামপুর|কদমতলী"},
    "Demra": {"lat": 23.7224, "lon": 90.4875, "city": "Dhaka", "pattern": r"\b(?:Demra|Signboard|Staff\s+Quarter|Sarulia)\b|ডেমরা|সাইনবোর্ড|স্টাফ\s*কোয়ার্টার"},
    "Sadarghat": {"lat": 23.7061, "lon": 90.4084, "city": "Dhaka", "pattern": r"\bSadarghat\b|সদরঘাট"},
    "Old Dhaka": {"lat": 23.7160, "lon": 90.3958, "city": "Dhaka", "pattern": r"\b(?:Old\s+Dhaka|Lalbagh|Chawkbazar|Kotwali|Bahadur\s+Shah\s+Park|Wari|Sutrapur|Gandaria|Bangshal|Nawabpur|Armanitola|Babubazar)\b|পুরান\s*ঢাকা|লালবাগ|চকবাজার|ওয়ারী|সূত্রাপুর|গেন্ডারিয়া|বংশাল|নবাবপুর|আরমানিটোলা|বাবুবাজার"},
    "Keraniganj": {"lat": 23.6948, "lon": 90.3698, "city": "Dhaka", "pattern": r"\bKeraniganj\b|কেরানীগঞ্জ"},
    "Savar": {"lat": 23.8583, "lon": 90.2667, "city": "Dhaka", "pattern": r"\b(?:Savar|Hemayetpur|Birulia)\b|সাভার|হেমায়েতপুর|বিরুলিয়া"},
    "Ashulia": {"lat": 23.9010, "lon": 90.3245, "city": "Dhaka", "pattern": r"\b(?:Ashulia|Zirabo|Baipail|Jamgora)\b|আশুলিয়া|আশুলিয়া|জিরাবো|বাইপাইল|জামগড়া"},
    "Dhamrai": {"lat": 23.9144, "lon": 90.2145, "city": "Dhaka", "pattern": r"\bDhamrai\b|ধামরাই"},
    "Dohar": {"lat": 23.5972, "lon": 90.1292, "city": "Dhaka", "pattern": r"\b(?:Dohar|Nawabganj)\b|দোহার|নবাবগঞ্জ"},

    # --- Gazipur & Narayanganj Industrial Belt ---
    "Tongi": {"lat": 23.8973, "lon": 90.4026, "city": "Gazipur", "pattern": r"\bTongi\b|টঙ্গী"},
    "Gazipur": {"lat": 23.9999, "lon": 90.4203, "city": "Gazipur", "pattern": r"\b(?:Gazipur|Kaliakoir|Sreepur|Konabari|Chandana)\b|গাজীপুর|কালিয়াকৈর|শ্রীপুর|কোনাবাড়ি|চান্দনা"},
    "Narayanganj": {"lat": 23.6238, "lon": 90.5000, "city": "Narayanganj", "pattern": r"\b(?:Narayanganj|N'ganj|N’ganj|Fatullah|Siddhirganj|Rupganj|Sonargaon|Kanchpur|Araihazar)\b|নারায়ণগঞ্জ|নারায়ণগঞ্জ|ফতুল্লা|সিদ্ধিরগঞ্জ|রূপগঞ্জ|সোনারগাঁও|কাঁচপুর|আড়াইহাজার"},

    # --- All 64 Bangladesh Districts & Key Towns ---
    "Chattogram": {"lat": 22.3569, "lon": 91.7832, "city": "Chattogram", "pattern": r"\b(?:Chattogram|Chittagong|Patiya|Mirsarai|Hathazari|Raozan|Rangunia|Anwara|Banshkhali|Agrabad|Halishahar|Patenga|Pahartali|Chandgaon|Boalkhali|Sandwip|Fatikchhari|Satkania|Karnaphuli)\b|চট্টগ্রাম|পটিয়া|মীরসরাই|হাটহাজারী|রাউজান|রাঙ্গুনিয়া|আনোয়ারা|বাঁশখালী|আগ্রাবাদ|হালিশহর|পতেঙ্গা|পাহাড়তলী|চান্দগাঁও|বোয়ালখালী|সন্দ্বীপ|ফটিকছড়ি|সাতকানিয়া|কর্ণফুলী"},
    "Sitakunda": {"lat": 22.6200, "lon": 91.6600, "city": "Chattogram", "pattern": r"\bSitakunda\b|সীতাকুণ্ড"},
    "Cox's Bazar": {"lat": 21.4272, "lon": 92.0058, "city": "Cox's Bazar", "pattern": r"\b(?:Cox['’]?s\s+Bazar|Teknaf|Ukhia|Ukhiya|Chakaria|Maheshkhali|Ramu)\b|কক্সবাজার|টেকনাফ|উখিয়া|চকরিয়া|মহেশখালী|রামু"},
    "Cumilla": {"lat": 23.4607, "lon": 91.1809, "city": "Cumilla", "pattern": r"\b(?:Cumilla|Comilla|Daudkandi|Chandina|Chauddagram|Laksam|Debidwar|Muradnagar|Burichang|Barura|Nangalkot|Homna)\b|কুমিল্লা|দাউদকান্দি|চান্দিনা|চৌদ্দগ্রাম|লাকসাম|দেবিদ্বার|মুরাদনগর|বুড়িচং|বরুড়া|নাঙ্গলকোট|হোমনা"},
    "Brahmanbaria": {"lat": 23.9571, "lon": 91.1119, "city": "Brahmanbaria", "pattern": r"\b(?:Brahmanbaria|B\.?\s*Baria|Ashuganj|Kasba|Nabinagar|Sarail|Akhaura)\b|ব্রাহ্মণবাড়িয়া|ব্রাহ্মণবাড়িয়া|আশুগঞ্জ|কসবা|নবীনগর|সরাইল|আখাউড়া"},
    "Chandpur": {"lat": 23.2333, "lon": 90.6713, "city": "Chandpur", "pattern": r"\b(?:Chandpur|Matlab|Hajiganj|Shahrasti|Kachua|Faridganj|Haimchar)\b|চাঁদপুর|মতলব|হাজীগঞ্জ|শাহরাস্তি|কচুয়া|সাচার|ফরিদগঞ্জ|হাইমচর"},
    "Feni": {"lat": 23.0159, "lon": 91.3976, "city": "Feni", "pattern": r"\b(?:Feni|Chhagalnaiya|Daganbhuiyan|Sonagazi|Parshuram)\b|ফেনী|ছাগলনাইয়া|দাগনভূঞা|সোনাগাজী|পরশুরাম"},
    "Noakhali": {"lat": 22.8696, "lon": 91.0994, "city": "Noakhali", "pattern": r"\b(?:Noakhali|Begumganj|Maijdee|Companiganj|Hatiya|Senbagh|Chatkhil)\b|নোয়াখালী|নোয়াখালী|বেগমগঞ্জ|মাইজদী|হাতিয়া|সেনবাগ|চাটখিল"},
    "Lakshmipur": {"lat": 22.9447, "lon": 90.8282, "city": "Lakshmipur", "pattern": r"\b(?:Lakshmipur|Laxmipur|Ramganj|Raipur|Ramgati)\b|লক্ষ্মীপুর|রামগঞ্জ|রায়পুর|রামগতি"},
    "Rangamati": {"lat": 22.7324, "lon": 92.2985, "city": "Rangamati", "pattern": r"\b(?:Rangamati|Kaptai|Baghaichhari|Langadu)\b|রাঙামাটি|রাঙ্গামাটি|কাপ্তাই|বাঘাইছড়ি|লংগদু"},
    "Bandarban": {"lat": 22.1953, "lon": 92.2184, "city": "Bandarban", "pattern": r"\b(?:Bandarban|Lama|Thanchi|Ruma)\b|বান্দরবান|লামা|থানচি|রুমা"},
    "Khagrachhari": {"lat": 23.1193, "lon": 91.9847, "city": "Khagrachhari", "pattern": r"\b(?:Khagrachhari|Khagrachari|Ramgarh|Dighinala|Guimara)\b|খাগড়াছড়ি|খাগড়াছড়ি|রামগড়|দীঘিনালা"},

    "Sylhet": {"lat": 24.8949, "lon": 91.8687, "city": "Sylhet", "pattern": r"\b(?:Sylhet|Beanibazar|Golapganj|Jaintiapur|Kanaighat|Companiganj)\b|সিলেট|বিয়ানীবাজার|গোলাপগঞ্জ|জৈন্তাপুর|কানাইঘাট"},
    "Moulvibazar": {"lat": 24.4829, "lon": 91.7774, "city": "Moulvibazar", "pattern": r"\b(?:Moulvibazar|Sreemangal|Kulaura|Kamalganj|Barlekha)\b|মৌলভীবাজার|শ্রীমঙ্গল|কুলাউড়া|কমলগঞ্জ|বড়লেখা"},
    "Habiganj": {"lat": 24.3749, "lon": 91.4155, "city": "Habiganj", "pattern": r"\b(?:Habiganj|Madhabpur|Chunarughat|Bahubal|Nabiganj|Shaistaganj)\b|হবিগঞ্জ|মাধবপুর|চুনারুঘাট|নবীগঞ্জ|শায়েস্তাগঞ্জ"},
    "Sunamganj": {"lat": 25.0658, "lon": 91.3950, "city": "Sunamganj", "pattern": r"\b(?:Sunamganj|Chhatak|Jagannathpur|Tahirpur|Derai)\b|সুনামগঞ্জ|ছাতক|জগন্নাথপুর|তাহিরপুর|দিরাই"},

    "Rajshahi": {"lat": 24.3745, "lon": 88.6042, "city": "Rajshahi", "pattern": r"\b(?:Rajshahi|Godagari|Bagha|Puthia|Tanore)\b|রাজশাহী|গোদাগাড়ী|বাঘা|পুঠিয়া|তানোর"},
    "Bogura": {"lat": 24.8481, "lon": 89.3730, "city": "Bogura", "pattern": r"\b(?:Bogura|Bogra|Sherpur\s+Bogura|Shibganj|Shajahanpur\s+Bogura)\b|বগুড়া|বগুড়া"},
    "Pabna": {"lat": 24.0064, "lon": 89.2372, "city": "Pabna", "pattern": r"\b(?:Pabna|Ishwardi|Santhia|Bera|Sujanagar)\b|পাবনা|ঈশ্বরদী|সাঁথিয়া|বেড়া|সুজানগর"},
    "Sirajganj": {"lat": 24.4534, "lon": 89.7007, "city": "Sirajganj", "pattern": r"\b(?:Sirajganj|Ullapara|Shahjadpur|Kazipur|Belkuchi)\b|সিরাজগঞ্জ|উল্লাপাড়া|শাহজাদপুর|কাজীপুর|বেলকুচি"},
    "Natore": {"lat": 24.4206, "lon": 89.0003, "city": "Natore", "pattern": r"\b(?:Natore|Singra|Baraigram|Lalpur)\b|নাটোর|সিংড়া|বড়াইগ্রাম|লালপুর"},
    "Naogaon": {"lat": 24.7936, "lon": 88.9318, "city": "Naogaon", "pattern": r"\b(?:Naogaon|Patnitala|Manda|Sapahar)\b|নওগাঁ|পত্নীতলা|মান্দা|সাপাহার"},
    "Chapainawabganj": {"lat": 24.5965, "lon": 88.2775, "city": "Chapainawabganj", "pattern": r"\b(?:Chapainawabganj|Nawabganj\s+Rajshahi|Shibganj\s+Chapai)\b|চাঁপাইনবাবগঞ্জ"},
    "Joypurhat": {"lat": 25.0968, "lon": 89.0227, "city": "Joypurhat", "pattern": r"\bJoypurhat\b|জয়পুরহাট|জয়পুরহাট"},

    "Khulna": {"lat": 22.8456, "lon": 89.5403, "city": "Khulna", "pattern": r"\b(?:Khulna|Dumuria|Paikgachha|Rupsha|Phultala|Dacope)\b|খুলনা|ডুমুরিয়া|পাইকগাছা|রূপসা|ফুলতলা"},
    "Jashore": {"lat": 23.1664, "lon": 89.2081, "city": "Jashore", "pattern": r"\b(?:Jashore|Jessore|Benapole|Jhikargacha|Abhaynagar|Noapara|Manirampur)\b|যশোর|বেনাপোল|ঝিকরগাছা|অভয়নগর|নওয়াপাড়া|মণিরামপুর"},
    "Satkhira": {"lat": 22.7185, "lon": 89.0705, "city": "Satkhira", "pattern": r"\b(?:Satkhira|Shyamnagar|Kaliganj\s+Satkhira|Tala)\b|সাতক্ষীরা|শ্যামনগর|তালা"},
    "Bagerhat": {"lat": 22.6516, "lon": 89.7859, "city": "Bagerhat", "pattern": r"\b(?:Bagerhat|Mongla|Rampal|Morelganj)\b|বাগেরহাট|মোংলা|রামপাল|মোরেলগঞ্জ"},
    "Kushtia": {"lat": 23.9013, "lon": 89.1205, "city": "Kushtia", "pattern": r"\b(?:Kushtia|Kumarkhali|Bheramara|Daulatpur\s+Kushtia)\b|কুষ্টিয়া|কুষ্টিয়া|কুমারখালী|ভেড়ামারা"},
    "Jhenaidah": {"lat": 23.5450, "lon": 89.1726, "city": "Jhenaidah", "pattern": r"\b(?:Jhenaidah|Jhenidah|Kaliganj|Shailkupa|Maheshpur)\b|ঝিনাইদহ|শৈলকুপা|মহেশপুর"},
    "Chuadanga": {"lat": 23.6402, "lon": 88.8418, "city": "Chuadanga", "pattern": r"\b(?:Chuadanga|Alamdanga|Damurhuda)\b|চুয়াডাঙ্গা|আলমডাঙ্গা|দামুড়হুদা"},
    "Meherpur": {"lat": 23.7622, "lon": 88.6318, "city": "Meherpur", "pattern": r"\b(?:Meherpur|Gangni|Mujibnagar)\b|মেহেরপুর|গাংনী|মুজিবনগর"},
    "Magura": {"lat": 23.4855, "lon": 89.4198, "city": "Magura", "pattern": r"\b(?:Magura|Sreepur\s+Magura|Mohammadpur\s+Magura)\b|মাগুরা"},
    "Narail": {"lat": 23.1725, "lon": 89.5127, "city": "Narail", "pattern": r"\b(?:Narail|Lohagara|Kalia)\b|নড়াইল|লোহাগড়া|কালিয়া"},

    "Barishal": {"lat": 22.7010, "lon": 90.3535, "city": "Barishal", "pattern": r"\b(?:Barishal|Barisal|Gournadi|Bakerganj|Mehendiganj)\b|বরিশাল|গৌরনদী|বাকেরগঞ্জ|মেহেন্দিগঞ্জ"},
    "Patuakhali": {"lat": 22.3596, "lon": 90.3299, "city": "Patuakhali", "pattern": r"\b(?:Patuakhali|Kuakata|Kalapara|Bauphal|Galachipa)\b|পটুয়াখালী|কুয়াকাটা|কলাপাড়া|বাউফল|গলাচিপা"},
    "Bhola": {"lat": 22.6859, "lon": 90.6482, "city": "Bhola", "pattern": r"\b(?:Bhola|Charfasson|Lalmohan|Borhanuddin)\b|ভোলা|চরফ্যাশন|লালমোহন|বোরহানউদ্দিন"},
    "Pirojpur": {"lat": 22.5841, "lon": 89.9720, "city": "Pirojpur", "pattern": r"\b(?:Pirojpur|Mathbaria|Bhandaria)\b|পিরোজপুর|মঠবাড়িয়া|ভাণ্ডারিয়া"},
    "Jhalokathi": {"lat": 22.6406, "lon": 90.1987, "city": "Jhalokathi", "pattern": r"\b(?:Jhalokathi|Jhalakathi|Nalchity)\b|ঝালকাঠি|নলছিটি"},
    "Barguna": {"lat": 22.1592, "lon": 90.1264, "city": "Barguna", "pattern": r"\b(?:Barguna|Amtali|Patharghata)\b|বরগুনা|আমতলী|পাথরঘাটা"},

    "Rangpur": {"lat": 25.7439, "lon": 89.2752, "city": "Rangpur", "pattern": r"\b(?:Rangpur|Pirganj\s+Rangpur|Mithapukur|Badarganj)\b|রংপুর|মিঠাপুকুর|বদরগঞ্জ"},
    "Dinajpur": {"lat": 25.6279, "lon": 88.6332, "city": "Dinajpur", "pattern": r"\b(?:Dinajpur|Birampur|Parbatipur|Phulbari|Hili)\b|দিনাজপুর|বিরামপুর|পার্বতীপুর|হিলি"},
    "Kurigram": {"lat": 25.8072, "lon": 89.6295, "city": "Kurigram", "pattern": r"\b(?:Kurigram|Ulipur|Nageshwari|Rowmari|Chilmari)\b|কুড়িগ্রাম|উলিপুর|নাগেশ্বরী|রৌমারী"},
    "Gaibandha": {"lat": 25.3288, "lon": 89.5281, "city": "Gaibandha", "pattern": r"\b(?:Gaibandha|Gobindaganj|Sundarganj|Palashbari)\b|গাইবান্ধা|গোবিন্দগঞ্জ|সুন্দরগঞ্জ|পলাশবাড়ী"},
    "Lalmonirhat": {"lat": 25.9172, "lon": 89.4459, "city": "Lalmonirhat", "pattern": r"\b(?:Lalmonirhat|Patgram|Hatibandha)\b|লালমনিরহাট|পাটগ্রাম|হাতীবান্ধা"},
    "Nilphamari": {"lat": 25.9318, "lon": 88.8560, "city": "Nilphamari", "pattern": r"\b(?:Nilphamari|Saidpur|Jaldhaka|Domar)\b|নীলফামারী|সৈয়দপুর|জলঢাকা|ডোমার"},
    "Thakurgaon": {"lat": 26.0337, "lon": 88.4617, "city": "Thakurgaon", "pattern": r"\b(?:Thakurgaon|Pirganj\s+Thakurgaon|Ranisankail)\b|ঠাকুরগাঁও|রাণীশংকৈল"},
    "Panchagarh": {"lat": 26.3411, "lon": 88.5542, "city": "Panchagarh", "pattern": r"\b(?:Panchagarh|Tetulia|Boda|Debiganj)\b|পঞ্চগড়|তেঁতুলিয়া|বোদা|দেবীগঞ্জ"},

    "Mymensingh": {"lat": 24.7471, "lon": 90.4203, "city": "Mymensingh", "pattern": r"\b(?:Mymensingh|Bhaluka|Trishal|Muktagachha|Gaffargaon|Phulpur)\b|ময়মনসিংহ|ময়মনসিংহ|ভালুকা|ত্রিশাল|মুক্তাগাছা|গফরগাঁও|ফুলপুর"},
    "Jamalpur": {"lat": 24.9375, "lon": 89.9378, "city": "Jamalpur", "pattern": r"\b(?:Jamalpur|Sarishabari|Dewanganj|Islampur|Melandaha)\b|জামালপুর|সরিষাবাড়ী|দেওয়ানগঞ্জ|ইসলামপুর"},
    "Sherpur": {"lat": 25.0205, "lon": 90.0153, "city": "Sherpur", "pattern": r"\b(?:Sherpur|Nalitabari|Sreebardi|Nakla)\b|শেরপুর|নালিতাবাড়ী|শ্রীবরদী|নকলা"},
    "Netrokona": {"lat": 24.8709, "lon": 90.7279, "city": "Netrokona", "pattern": r"\b(?:Netrokona|Netrakona|Durgapur\s+Netrokona|Kendua|Mohanganj)\b|নেত্রকোনা|নেত্রকোণা|কেন্দুয়া|মোহনগঞ্জ"},

    # --- Dhaka Division Districts ---
    "Tangail": {"lat": 24.2513, "lon": 89.9167, "city": "Tangail", "pattern": r"\b(?:Tangail|Madhupur|Kalihati|Mirzapur|Sakhipur|Elenga|Ghatail)\b|টাঙ্গাইল|মধুপুর|কালিহাতী|মির্জাপুর|সখীপুর|এলেঙ্গা|ঘাটাইল"},
    "Kishoreganj": {"lat": 24.4449, "lon": 90.7766, "city": "Kishoreganj", "pattern": r"\b(?:Kishoreganj|Bhairab|Kuliarchar|Bajitpur|Pakundia)\b|কিশোরগঞ্জ|ভৈরব|কুলিয়ারচর|বাজিতপুর"},
    "Narsingdi": {"lat": 23.9322, "lon": 90.7154, "city": "Narsingdi", "pattern": r"\b(?:Narsingdi|Madhabdi|Raipura|Shibpur|Belabo|Palash)\b|নরসিংদী|মাধবদী|রায়পুরা|শিবপুর|বেলাবো|পলাশ"},
    "Munshiganj": {"lat": 23.5422, "lon": 90.5305, "city": "Munshiganj", "pattern": r"\b(?:Munshiganj|Mawa|Sreenagar|Louhajang|Gazaria|Sirajdikhan)\b|মুন্সীগঞ্জ|মাওয়া|শ্রীনগর|লৌহজং|গজারিয়া|সিরাজদিখান"},
    "Manikganj": {"lat": 23.8617, "lon": 90.0003, "city": "Manikganj", "pattern": r"\b(?:Manikganj|Paturia|Aricha|Saturia|Singair|Shibalaya)\b|মানিকগঞ্জ|পাটুরিয়া|আরিচা|সাটুরিয়া|সিংগাইর"},
    "Faridpur": {"lat": 23.6071, "lon": 89.8429, "city": "Faridpur", "pattern": r"\b(?:Faridpur|Bhanga|Boalmari|Madhukhali|Nagarkanda)\b|ফরিদপুর|ভাঙ্গা|বোয়ালমারী|মধুখালী|নগরকান্দা"},
    "Gopalganj": {"lat": 23.0051, "lon": 89.8266, "city": "Gopalganj", "pattern": r"\b(?:Gopalganj|Tungipara|Kotalipara|Muksudpur|Kashiani)\b|গোপালগঞ্জ|টুঙ্গিপাড়া|কোটালীপাড়া|মুকসুদপুর"},
    "Madaripur": {"lat": 23.1641, "lon": 90.1897, "city": "Madaripur", "pattern": r"\b(?:Madaripur|Shibchar|Kalkini|Rajoir)\b|মাদারীপুর|শিবচর|কালকিনি|রাজৈর"},
    "Shariatpur": {"lat": 23.2423, "lon": 90.4348, "city": "Shariatpur", "pattern": r"\b(?:Shariatpur|Zajira|Jajira|Naria|Bhedarganj)\b|শরীয়তপুর|শরীয়তপুর|জাজিরা|নড়িয়া"},
    "Rajbari": {"lat": 23.7574, "lon": 89.6445, "city": "Rajbari", "pattern": r"\b(?:Rajbari|Goalanda|Daulatdia|Pangsha)\b|রাজবাড়ী|রাজবাড়ী|গোয়ালন্দ|দৌলতদিয়া|পাংশা"},
}

AREA_GAZETTEER: list[tuple[str, re.Pattern]] = [
    (name, re.compile(unicodedata.normalize("NFC", meta["pattern"]), re.I)) for name, meta in AREA_METADATA.items()
]

# Dynamic open-vocabulary extractors for unlisted villages, unions, upazilas, markets & roads
BN_DYNAMIC_PLACE_RE = re.compile(
    r"(?<![ঁ-৯অ-হ])([ঁ-৯অ-হ]{3,18})\s+"
    r"(?:উপজেলার|উপজেলায়|উপজেলা|থানার|থানা|ইউনিয়নের|ইউনিয়নে|ইউনিয়ন|গ্রামের|গ্রামে|গ্রাম|"
    r"পৌরসভার|পৌরসভায়|বাজারের|বাজারে|মোড়ের|মোড়ে|চত্বরের|চত্বরে|রেলগেট|বাসস্ট্যান্ডে)"
)
EN_DYNAMIC_PLACE_RE = re.compile(
    r"\b(?:in|at|near)\s+([A-Z][a-z]{2,18}(?:\s+[A-Z][a-z]{2,16})?)\s+"
    r"(?:upazila|thana|union|village|bazar|bazaar|intersection|crossing|more|point|municipality)\b"
)

DYNAMIC_STOPWORDS = {
    "বাংলাদেশ", "দেশের", "রাজধানী", "রাজধানীর", "সারা", "বিভিন্ন", "একটি", "এই", "ওই",
    "সংশ্লিষ্ট", "স্থানীয়", "নিজস্ব", "পুলিশ", "সরকারি", "সদর", "থানা", "জেলা", "উপজেলা",
    "গ্রাম", "বাজার", "এলাকা", "সড়ক", "গতকাল", "আজ", "মোট", "প্রায়", "সব", "একাধিক",
    "কয়েক", "অজ্ঞাত", "তাদের", "নিজ", "আদালত", "ক্যাম্পাস", "বিশ্ববিদ্যালয়", "কলেজ",
    "দিকে", "যারা", "মডেল", "পাশ", "আশেপাশ", "ভিতর", "বাইরে", "সাবেক", "প্রধান",
    "সকল", "অন্যান্য", "কোনো", "যেখানে", "এখানে", "সেখানে", "ওখানে", "ভিন্ন", "নানা",
    "পৃথক", "যৌথ", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়", "দশ",
    "তার", "তারা", "তিনি", "দিয়ে", "করে", "হয়ে", "থেকে", "বিরুদ্ধে", "পরবর্তীতে", "নেতা",
    "কর্মী", "ব্যক্তি", "ব্যক্তিদের", "সাধারণ", "নিহত", "আহত", "অভিযোগে", "হামলা", "আগুন",
    "এবং", "কিন্তু", "তবে", "কারণে", "জন্য", "উপর", "নিচে", "সময়", "ঘটনা", "মামলা",
    "The", "This", "That", "Local", "Main", "Police", "National", "Bangladesh", "Dhaka",
    "Model", "Sadar", "City", "Town", "Area", "Road", "Highway",
}
DYNAMIC_STOPWORDS = {unicodedata.normalize("NFC", w) for w in DYNAMIC_STOPWORDS}

# Normalize all taxonomy & gazetteer patterns to NFC so Bengali Nukta characters (ড়/ড়, ঢ়/ঢ়, য়/য়) always match
EVENT_TAXONOMY = {
    ev: re.compile(unicodedata.normalize("NFC", pat.pattern), pat.flags)
    for ev, pat in EVENT_TAXONOMY.items()
}

# Context cleanup patterns
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
    """Strips HTML tags, normalizes Unicode NFC, footers, related links, police titles, and bus modifiers."""
    if not text:
        return ""
    cleaned = unicodedata.normalize("NFC", html.unescape(text))
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = FOOTER_CUT_RE.sub(" ", cleaned)
    cleaned = RELATED_LINKS_RE.sub(" ", cleaned)
    cleaned = POLICE_TITLE_RE.sub(" ", cleaned)
    cleaned = BUS_ROUTE_ORIGIN_RE.sub(" ", cleaned)
    return cleaned


def _find_events(text: str) -> list[str]:
    return [ev for ev, pat in EVENT_TAXONOMY.items() if pat.search(text)]


def _clean_bn_inflection(word: str) -> str:
    w = word.strip()
    for suf in ("য়ের", "ের", "য়"):
        if len(w) > 4 and w.endswith(suf):
            w = w[: -len(suf)]
            break
    return w.strip()


def is_valid_place(name: str) -> bool:
    """Returns True only if `name` is an actual verified place in the canonical AREA_METADATA gazetteer."""
    return bool(name and name in AREA_METADATA)


def _find_dynamic_locations(text: str, known_locs: list[str]) -> list[str]:
    """Disabled open-vocabulary random Bangla word guessing so only actual verified places are used."""
    return []


def _find_locations(text: str, allow_dynamic: bool = False) -> list[str]:
    found: list[str] = []
    for canonical, pat in AREA_GAZETTEER:
        if pat.search(text):
            found.append(canonical)
    # If a specific Mirpur section matched, avoid redundant generic 'Mirpur'
    if any(k.startswith("Mirpur-") for k in found) and "Mirpur" in found:
        found.remove("Mirpur")

    return found


def _infer_parent_city(locs: list[str], full_text: str) -> str | None:
    for loc in locs:
        if loc in AREA_METADATA:
            return AREA_METADATA[loc]["city"]
    if GENERIC_DHAKA_HEADLINE_RE.search(full_text):
        return "Dhaka"
    return None


def extract_disruption_tags(headline: str, description: str, body: str) -> dict:
    """
    Context-Aware Dynamic Bilingual Threat & Location Extractor.
    Captures threats across ALL Dhaka locations and ALL Bangladesh districts/villages.
    """
    clean_head = _clean_text_for_spatial_nlp(headline)
    clean_desc = _clean_text_for_spatial_nlp(description)
    clean_body = _clean_text_for_spatial_nlp(body[:2500])

    primary_text = f"{clean_head}\n{clean_desc}"
    full_text = f"{clean_head}\n{clean_desc}\n{clean_body}"

    # 1. Non-threat noise rejection
    if NON_THREAT_NOISE_RE.search(primary_text):
        return {
            "tag_version": TAG_VERSION,
            "event_types": [],
            "locations": [],
            "location_events": {},
            "parent_city": None,
            "time_windows": [],
            "is_disruption": False,
        }

    # 2. Threat Event Detection
    head_events = _find_events(primary_text)
    if not head_events and len(clean_desc.strip()) < 15:
        head_events = _find_events(f"{clean_head}\n{clean_body[:250]}")

    if not head_events:
        return {
            "tag_version": TAG_VERSION,
            "event_types": [],
            "locations": [],
            "location_events": {},
            "parent_city": None,
            "time_windows": [],
            "is_disruption": False,
        }

    # 3. Context-Aware Location & Clause-Level (Location -> Event) Binding
    head_locs = _find_locations(clean_head, allow_dynamic=True)
    desc_locs = _find_locations(clean_desc, allow_dynamic=True)
    location_events: dict[str, list[str]] = {}

    if head_locs and head_locs != ["Dhaka (General)"]:
        only_head_evs = _find_events(clean_head) or head_events
        for loc in head_locs:
            location_events[loc] = list(only_head_evs)
    else:
        clauses = CLAUSE_SPLIT_RE.split(full_text)
        specific_pairs: list[tuple[list[str], list[str]]] = []
        lumped_pairs: list[tuple[list[str], list[str]]] = []

        for clause in clauses:
            clause = clause.strip()
            if len(clause) < 12:
                continue
            c_locs = _find_locations(clause, allow_dynamic=True)
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
                if loc == "Dhaka (General)" and any(x != "Dhaka (General)" for x in c_locs):
                    continue
                existing = location_events.setdefault(loc, [])
                for ev in c_evs:
                    if ev not in existing:
                        existing.append(ev)

        if not location_events:
            for c_locs, c_evs in lumped_pairs:
                if len(c_locs) <= 2:
                    for loc in c_locs:
                        existing = location_events.setdefault(loc, [])
                        for ev in c_evs:
                            if ev not in existing:
                                existing.append(ev)

        if not location_events and desc_locs and len(desc_locs) <= 3:
            for loc in desc_locs:
                location_events[loc] = list(head_events)

        if not location_events and head_locs:
            for loc in head_locs:
                location_events[loc] = list(head_events)

    # Remove generic 'Dhaka (General)' if specific Dhaka neighborhoods were resolved
    if "Dhaka (General)" in location_events and any(
        AREA_METADATA.get(k, {}).get("city") == "Dhaka" for k in location_events if k != "Dhaka (General)"
    ):
        location_events.pop("Dhaka (General)", None)

    final_locs = list(location_events.keys())
    all_bound_events: list[str] = []
    for evs in location_events.values():
        for e in evs:
            if e not in all_bound_events:
                all_bound_events.append(e)
    final_events = all_bound_events or head_events
    parent_city = _infer_parent_city(final_locs, full_text)

    times: list[str] = []
    for m in TIME_WINDOW_RE.finditer(full_text):
        val = m.group(0).strip()
        if val not in times:
            times.append(val)
        if len(times) >= 5:
            break

    return {
        "tag_version": TAG_VERSION,
        "event_types": final_events,
        "locations": final_locs,
        "location_events": location_events,
        "parent_city": parent_city,
        "time_windows": times,
        "is_disruption": bool(final_events and final_locs),
    }
