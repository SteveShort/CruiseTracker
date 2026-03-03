using Dapper;
using Microsoft.Data.SqlClient;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.UseDeveloperExceptionPage();

var env = app.Environment;
Console.WriteLine($"[DEBUG] App started. Environment: {env.EnvironmentName}");
Console.WriteLine($"[DEBUG] ContentRootPath: {env.ContentRootPath}");
Console.WriteLine($"[DEBUG] WebRootPath: {env.WebRootPath}");

var connectionString = @"Server=STEVEOFFICEPC\ORACLE2SQL;Database=CruiseTracker;User Id=CruiseDashboard;Password=Cruise2026!Tracker;TrustServerCertificate=True;";

app.UseStaticFiles();

// ── Ship Reference (in-memory, matches LINQPad script) ─────────────────
var ships = new Dictionary<string, ShipInfo>(StringComparer.OrdinalIgnoreCase)
{
    // DISNEY                                                         SuiteName    Mult KidsR ShipR  MainDin PkgDin SuiteDin PkgCost
    ["Disney Magic"] = new("family", "Disney", "Disney Magic", "Magic", 1998, "2023", 83969, 2713, true,
        "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)", "Concierge", 0m,
        "AquaDunk water slide, 3 pools", "Smallest Disney ship; classic feel; great for short itineraries",
        85, 78, 82, 88, 0, 16m),
    ["Disney Wonder"] = new("family", "Disney", "Disney Wonder", "Magic", 1999, "2019", 83969, 2713, true,
        "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)", "Concierge", 0m,
        "Twist 'n' Spout slide, 3 pools", "Sister to Magic; sails Pacific/Alaska primarily",
        85, 78, 82, 88, 0, 16m),
    ["Disney Dream"] = new("family", "Disney", "Disney Dream", "Dream", 2011, "2022", 129690, 4000, true,
        "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)", "Concierge", 0m,
        "AquaDuck water coaster, Nemo's Reef splash zone", "First AquaDuck ship; excellent for Bahamas from Port Canaveral",
        92, 85, 85, 92, 0, 25m),
    ["Disney Fantasy"] = new("family", "Disney", "Disney Fantasy", "Dream", 2012, "2023", 129690, 4000, true,
        "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)", "Concierge", 0m,
        "AquaDuck water coaster, AquaLab splash zone", "Same layout as Dream; sails 7-night Caribbean from Port Canaveral",
        95, 85, 85, 92, 0, 25m),
    ["Disney Wish"] = new("family", "Disney", "Disney Wish", "Wish (Triton)", 2022, "None", 144000, 4000, true,
        "Oceaneer Club w/ slide entrance (3-10), Edge (11-14), Vibe (14-17), Hideaway", "Concierge", 0m,
        "AquaMouse water ride, 6 pools, Toy Story splash zone", "Grand Hall with Rapunzel theme; most dining venues of any Disney ship",
        98, 98, 88, 95, 0, 28m),
    ["Disney Treasure"] = new("family", "Disney", "Disney Treasure", "Wish (Triton)", 2024, "None", 144000, 4000, true,
        "Oceaneer Club w/ slide entrance (3-10), Edge (11-14), Vibe (14-17), Hideaway", "Concierge", 0m,
        "AquaMouse water ride, 6 pools", "Adventure-themed; Moana/Coco Grand Hall; newest Disney ship sailing",
        98, 98, 88, 95, 0, 28m),
    ["Disney Destiny"] = new("family", "Disney", "Disney Destiny", "Wish (Triton)", 2025, "None", 144000, 4000, true,
        "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17), Hideaway", "Concierge", 0m,
        "AquaMouse water ride, 6 pools", "Heroes & Villains theme; enters service Nov 2025; sails from Ft Lauderdale",
        98, 98, 88, 95, 0, 28m),

    // NORWEGIAN                                                      SuiteName    Mult  KidsR ShipR  MainDin PkgDin SuiteDin PkgCost
    ["Norwegian Prima"] = new("family", "Norwegian", "Norwegian Prima", "Prima", 2022, "None", 142500, 3215, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.4m,
        "Tidal Wave slide, Aqua Park drop slides, Infinity pool", "First Prima class; Haven sundeck + infinity pool; Galaxy Pavilion VR",
        85, 95, 78, 92, 95, 15m),
    ["Norwegian Viva"] = new("family", "Norwegian", "Norwegian Viva", "Prima", 2023, "None", 142500, 3215, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.4m,
        "Tidal Wave slide, Aqua Park double drops, Infinity pool", "Sister to Prima; Haven with retractable glass roof courtyard",
        85, 95, 78, 92, 95, 15m),
    ["Norwegian Aqua"] = new("family", "Norwegian", "Norwegian Aqua", "Prima Plus", 2025, "None", 156300, 3571, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.5m,
        "Aqua Slidecoaster, AquaLoop freefall, The Pier pool", "Largest NCL ship; elevated Haven with duplex suites; debuts 2025",
        95, 98, 78, 95, 98, 15m),
    ["Norwegian Aura"] = new("family", "Norwegian", "Norwegian Aura", "Prima Plus", 2027, "None", 169000, 3840, true,
        "Little Explorer's Cove (2-6), Adventure Alley (6-10), Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.5m,
        "Eclipse Racers dueling slides, Aura Free Fall drop slide, The Wave raft slide, The Drop 10-deck dry slide, Kids Aqua Park, 82ft ropes course", "Largest NCL ever; Ocean Heights multi-deck activity complex; Haven 3-BR duplex suites; incredible for families with young kids",
        98, 98, 78, 95, 98, 15m),
    ["Norwegian Luna"] = new("family", "Norwegian", "Norwegian Luna", "Prima Plus", 2026, "None", 156300, 3571, true,
        "Splash Academy (3-12), Entourage (13-17), Guppies (6mo-4yr)", "The Haven", 2.5m,
        "Aqua Slidecoaster, AquaLoop freefall, Kids Aqua Park, splash pad", "Sister to Aqua; Prima Plus class; full Haven with 3-BR duplex suites; Guppies nursery for toddlers; debuts Mar 2026",
        95, 98, 78, 95, 98, 15m),
    ["Norwegian Encore"] = new("family", "Norwegian", "Norwegian Encore", "Breakaway Plus", 2019, "2024", 169116, 3998, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 3.0m,
        "Aqua Park multi-story slides, go-kart racetrack", "Full Haven w/ private restaurant + pool; racetrack; excellent for families",
        88, 88, 78, 92, 95, 15m),
    ["Norwegian Bliss"] = new("family", "Norwegian", "Norwegian Bliss", "Breakaway Plus", 2018, "2021", 168028, 4004, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 3.0m,
        "Aqua Park with Ocean Loops, go-kart racetrack", "Full Haven; laser tag; observation lounge",
        88, 88, 78, 92, 95, 15m),
    ["Norwegian Joy"] = new("family", "Norwegian", "Norwegian Joy", "Breakaway Plus", 2017, "2024", 167725, 3804, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 3.0m,
        "Aqua Park, go-kart racetrack", "Full Haven; originally for Chinese market, refitted for US",
        85, 85, 78, 88, 92, 15m),
    ["Norwegian Escape"] = new("family", "Norwegian", "Norwegian Escape", "Breakaway Plus", 2015, "2022", 164600, 4266, true,
        "Splash Academy (3-12), Entourage (13-17), Guppies Nursery", "The Haven", 3.0m,
        "Aqua Park 5 multi-story slides, rope course", "Full Haven; one of the largest ships; sails from NYC primarily",
        88, 85, 78, 92, 95, 15m),
    ["Norwegian Breakaway"] = new("family", "Norwegian", "Norwegian Breakaway", "Breakaway", 2013, "2025", 145655, 3963, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.5m,
        "Aqua Park 5 slides, rope course, 2 pools", "Full Haven (slightly smaller); sails New Orleans/East Coast",
        85, 82, 78, 88, 88, 15m),
    ["Norwegian Getaway"] = new("family", "Norwegian", "Norwegian Getaway", "Breakaway", 2014, "2019", 145655, 3963, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.5m,
        "Aqua Park slides, rope course, pools", "Full Haven; sails Port Canaveral/Caribbean",
        85, 82, 78, 88, 88, 15m),
    ["Norwegian Epic"] = new("family", "Norwegian", "Norwegian Epic", "Epic", 2010, "2025", 155873, 4100, true,
        "Splash Academy (3-12), Entourage (13-17)", "Haven Suites", 2.5m,
        "Aqua Park with Epic Plunge, 3 pools, kids pool", "Haven suites but NO separate Haven restaurant/pool; unique studio cabins",
        82, 78, 75, 85, 85, 15m),
    ["Norwegian Gem"] = new("family", "Norwegian", "Norwegian Gem", "Jewel", 2007, "2015", 93530, 2394, true,
        "Splash Academy (3-12), Entourage (13-17)", "Haven Suites", 2.0m,
        "Pool deck, kids pool", "Haven courtyard but smaller/older; no private Haven restaurant",
        78, 75, 75, 82, 78, 12m),
    ["Norwegian Jewel"] = new("family", "Norwegian", "Norwegian Jewel", "Jewel", 2005, "2018", 93502, 2376, true,
        "Splash Academy (3-12), Entourage (13-17)", "Haven Suites", 2.0m,
        "Pool deck, kids pool", "Older Jewel class; Haven suites with limited private amenities",
        78, 75, 75, 82, 78, 12m),
    ["Norwegian Jade"] = new("family", "Norwegian", "Norwegian Jade", "Jewel", 2006, "2017", 93558, 2402, true,
        "Splash Academy (3-12), Entourage (13-17)", "Haven Suites", 2.0m,
        "Pool deck, kids pool", "Mostly European itineraries; limited Haven complex",
        78, 75, 75, 82, 78, 12m),
    ["Norwegian Pearl"] = new("family", "Norwegian", "Norwegian Pearl", "Jewel", 2006, "2017", 93530, 2394, true,
        "Splash Academy (3-12), Entourage (13-17)", "Haven Suites", 2.0m,
        "Bowl slide, pool deck, kids pool", "Jewel class; has bowling alley; Haven with limited private areas",
        78, 75, 75, 82, 78, 12m),
    ["Norwegian Dawn"] = new("family", "Norwegian", "Norwegian Dawn", "Dawn", 2002, "2021", 91740, 2340, true,
        "Splash Academy (3-12), Entourage (13-17)", "None", 0m,
        "Pool deck, kids pool", "NO Haven suites; older/smaller ship",
        75, 72, 75, 78, 75, 12m),
    ["Norwegian Star"] = new("family", "Norwegian", "Norwegian Star", "Dawn", 2001, "2018", 91740, 2348, true,
        "Splash Academy (3-12), Entourage (13-17)", "None", 0m,
        "Pool deck, kids pool", "NO Haven; primarily sails Europe",
        75, 72, 75, 78, 75, 12m),
    ["Norwegian Sun"] = new("family", "Norwegian", "Norwegian Sun", "Sun", 2001, "2018", 78309, 1936, true,
        "Splash Academy (3-12), Entourage (13-17)", "None", 0m,
        "Pool deck, kids pool", "NO Haven; smaller ship; port-intensive itineraries",
        72, 72, 72, 75, 72, 10m),
    ["Norwegian Sky"] = new("family", "Norwegian", "Norwegian Sky", "Sun", 1999, "2019", 77104, 2004, true,
        "Splash Academy (3-12), Entourage (13-17)", "None", 0m,
        "Pool deck", "NO Haven; free open bar included; short Bahamas from Miami",
        72, 72, 72, 75, 72, 10m),
    ["Norwegian Spirit"] = new("family", "Norwegian", "Norwegian Spirit", "Unclassed", 1998, "2020", 75338, 2018, false,
        "NO kids program (no Splash Academy)", "None", 0m,
        "Pool deck", "NO kids program AND no Haven — NOT SUITABLE for families",
        65, 68, 72, 75, 72, 10m),
    ["Pride of America"] = new("family", "Norwegian", "Pride of America", "Unclassed", 2005, "2025", 80439, 2186, true,
        "Splash Academy (3-12), Entourage (13-17)", "None", 0m,
        "Pool deck, kids pool", "Hawaii only (US-flagged); NO Haven; inter-island itinerary",
        75, 72, 75, 78, 75, 12m),

    // CELEBRITY                                                      SuiteName    Mult  KidsR ShipR  MainDin PkgDin SuiteDin PkgCost
    ["Celebrity Edge"] = new("family", "Celebrity", "Celebrity Edge", "Edge", 2018, "None", 130818, 2908, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Rooftop Garden, Resort Deck pool, solarium", "First Edge class; outward-facing design with Magic Carpet bar",
        82, 95, 92, 95, 98, 18m),
    ["Celebrity Apex"] = new("family", "Celebrity", "Celebrity Apex", "Edge", 2020, "None", 130818, 2910, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Rooftop Garden, Resort Deck pool, solarium", "Sails Caribbean from Port Canaveral; sister to Edge",
        82, 95, 92, 95, 98, 18m),
    ["Celebrity Beyond"] = new("family", "Celebrity", "Celebrity Beyond", "Edge", 2022, "None", 140600, 3260, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Rooftop Garden, multi-level Resort Deck, solarium", "Larger Edge-class variant; two-story Sunset Bar; sails from Ft Lauderdale",
        82, 98, 95, 98, 98, 18m),
    ["Celebrity Ascent"] = new("family", "Celebrity", "Celebrity Ascent", "Edge", 2023, "None", 140600, 3260, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Rooftop Garden, multi-level Resort Deck, solarium", "Sister to Beyond; sails Caribbean from Ft Lauderdale",
        82, 98, 95, 98, 98, 18m),
    ["Celebrity Xcel"] = new("family", "Celebrity", "Celebrity Xcel", "Edge", 2025, "None", 140600, 3260, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Rooftop Garden, Resort Deck, solarium", "Newest Celebrity ship; debuts Nov 2025 from Ft Lauderdale",
        82, 98, 95, 98, 98, 18m),
    ["Celebrity Eclipse"] = new("family", "Celebrity", "Celebrity Eclipse", "Solstice", 2010, "2019", 121878, 2850, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium, lawn club", "Solstice class; real grass Lawn Club; sails from Ft Lauderdale",
        78, 85, 88, 92, 95, 18m),
    ["Celebrity Silhouette"] = new("family", "Celebrity", "Celebrity Silhouette", "Solstice", 2011, "2020", 122210, 2886, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium, lawn club", "Solstice class; revolutionized with refurbishment; sails from Ft Lauderdale",
        78, 85, 88, 92, 95, 18m),
    ["Celebrity Reflection"] = new("family", "Celebrity", "Celebrity Reflection", "Solstice", 2012, "2020", 125366, 3046, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium, lawn club, The Alcoves", "Largest Solstice class; suite-only sundeck added; sails Ft Lauderdale",
        78, 88, 88, 92, 95, 18m),
    ["Celebrity Summit"] = new("family", "Celebrity", "Celebrity Summit", "Millennium", 2001, "2019", 90940, 2158, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium", "Millennium class; modernized 2019; smaller/more intimate; sails from Ft Lauderdale",
        75, 78, 85, 88, 92, 18m),
    ["Celebrity Constellation"] = new("family", "Celebrity", "Celebrity Constellation", "Millennium", 2002, "2024", 90940, 2170, true,
        "Camp at Sea (3-11), Teen Club (12-17)", "The Retreat", 2.0m,
        "2 pools (1 family, 1 Solarium adults-only), 4 hot tubs", "Millennium class; adult-forward vibe; no slides/water park; Camp at Sea is basic; good for older kids but limited for young boys",
        72, 78, 85, 88, 92, 18m),
    // ── Additional Celebrity ships ──────────────────────────────────
    ["Celebrity Equinox"] = new("family", "Celebrity", "Celebrity Equinox", "Solstice", 2009, "2019", 122000, 2850, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium, lawn club", "Solstice class; Revolution refurb 2019; sails Caribbean",
        78, 85, 88, 92, 95, 18m),
    ["Celebrity Solstice"] = new("family", "Celebrity", "Celebrity Solstice", "Solstice", 2008, "2016", 121878, 2852, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium, lawn club", "First Solstice class; introduced real grass Lawn Club; sails Alaska/Pacific",
        78, 85, 88, 92, 95, 18m),
    ["Celebrity Millennium"] = new("family", "Celebrity", "Celebrity Millennium", "Millennium", 2000, "2019", 90940, 2218, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium", "Millennium class; modernized 2019; sails Alaska/Asia",
        75, 78, 85, 88, 92, 18m),
    ["Celebrity Infinity"] = new("family", "Celebrity", "Celebrity Infinity", "Millennium", 2001, "2024", 90940, 2170, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium", "Millennium class; Revolution refurb 2024; sails South America/Panama Canal",
        75, 78, 85, 88, 92, 18m),
    ["Celebrity Flora"] = new("family", "Celebrity", "Celebrity Flora", "Galapagos", 2019, "None", 5739, 100, false,
        "None", "The Retreat", 2.0m,
        "Open-air decks, jacuzzi", "Galapagos expedition mega-yacht; 100 guests; eco-friendly dynamic positioning; all-suite",
        30, 82, 90, 90, 92, 18m),
    ["Celebrity Seeker"] = new("family", "Celebrity", "Celebrity Seeker", "Journeys", 2026, "None", 9300, 224, false,
        "None", "The Retreat", 2.0m,
        "Pool deck, marina", "New Journeys class; small luxury expedition yacht; debuting 2026",
        30, 80, 88, 90, 92, 18m),
    ["Celebrity Compass"] = new("family", "Celebrity", "Celebrity Compass", "Journeys", 2027, "None", 9300, 224, false,
        "None", "The Retreat", 2.0m,
        "Pool deck, marina", "Journeys class; sister to Seeker; debuting 2027",
        30, 80, 88, 90, 92, 18m),
    ["Celebrity Wanderer"] = new("family", "Celebrity", "Celebrity Wanderer", "Journeys", 2027, "None", 9300, 224, false,
        "None", "The Retreat", 2.0m,
        "Pool deck, marina", "Journeys class; debuting 2027",
        30, 80, 88, 90, 92, 18m),
    ["Celebrity Roamer"] = new("family", "Celebrity", "Celebrity Roamer", "Journeys", 2028, "None", 9300, 224, false,
        "None", "The Retreat", 2.0m,
        "Pool deck, marina", "Journeys class; debuting 2028",
        30, 80, 88, 90, 92, 18m),
    ["Celebrity Boundless"] = new("family", "Celebrity", "Celebrity Boundless", "Journeys", 2029, "None", 9300, 224, false,
        "None", "The Retreat", 2.0m,
        "Pool deck, marina", "Journeys class; debuting 2029",
        30, 80, 88, 90, 92, 18m),

    // OCEANIA (adult-only luxury)                                     SuiteName    Mult KidsR ShipR  MainDin PkgDin SuiteDin PkgCost
    ["Oceania Vista"] = new("adult", "Oceania", "Oceania Vista", "Allura", 2023, "None", 67000, 1200, false,
        "None", "Oceania Suite", 2.5m,
        "Pool, terrace", "Newest Allura-class; all dining included; The Finest Cuisine at Sea",
        0, 85, 92, 92, 95, 0m),
    ["Oceania Allura"] = new("adult", "Oceania", "Oceania Allura", "Allura", 2025, "None", 67000, 1200, false,
        "None", "Oceania Suite", 2.5m,
        "Pool, terrace", "Allura-class sister ship to Vista; all dining included",
        0, 85, 92, 92, 95, 0m),
    ["Oceania Marina"] = new("adult", "Oceania", "Oceania Marina", "Oceania", 2011, "2023", 66084, 1250, false,
        "None", "Oceania Suite", 2.5m,
        "Pool, canyon ranch spa", "Oceania-class; 6 open-seating restaurants",
        0, 82, 90, 90, 93, 0m),
    ["Oceania Riviera"] = new("adult", "Oceania", "Oceania Riviera", "Oceania", 2012, "2023", 66084, 1250, false,
        "None", "Oceania Suite", 2.5m,
        "Pool, canyon ranch spa", "Oceania-class; Jacques Pépin restaurant",
        0, 82, 90, 90, 93, 0m),
    ["Oceania Sirena"] = new("adult", "Oceania", "Oceania Sirena", "Regatta", 2016, "2019", 30277, 684, false,
        "None", "Owner's Suite", 3.0m,
        "Pool", "R-class; intimate ship; 4 restaurants",
        0, 78, 88, 88, 90, 0m),
    ["Oceania Insignia"] = new("adult", "Oceania", "Oceania Insignia", "Regatta", 1998, "2018", 30277, 684, false,
        "None", "Owner's Suite", 3.0m,
        "Pool", "R-class; world-voyage specialist",
        0, 76, 88, 88, 90, 0m),
    ["Oceania Nautica"] = new("adult", "Oceania", "Oceania Nautica", "Regatta", 2000, "2019", 30277, 684, false,
        "None", "Owner's Suite", 3.0m,
        "Pool", "R-class; intimate ship",
        0, 76, 88, 88, 90, 0m),
    ["Oceania Regatta"] = new("adult", "Oceania", "Oceania Regatta", "Regatta", 1998, "2019", 30277, 684, false,
        "None", "Owner's Suite", 3.0m,
        "Pool", "R-class; world-voyage specialist",
        0, 75, 88, 88, 90, 0m),
    ["Oceania Sonesta"] = new("adult", "Oceania", "Oceania Sonesta", "Allura", 2027, "None", 67000, 1200, false,
        "None", "Oceania Suite", 2.5m,
        "Pool, terrace", "Allura-class; planned 2027 debut",
        0, 85, 92, 92, 95, 0m),

    // REGENT SEVEN SEAS (ultra-luxury, all-suite, all-inclusive)        SuiteName    Mult KidsR ShipR  MainDin PkgDin SuiteDin PkgCost
    ["Seven Seas Explorer"] = new("adult", "Regent", "Seven Seas Explorer", "Explorer", 2016, "None", 55254, 750, false,
        "None", "Regent Suite", 4.0m,
        "Pool, spa", "All-suite, all-inclusive ultra-luxury; 375 suites",
        0, 92, 95, 95, 97, 0m),
    ["Seven Seas Splendor"] = new("adult", "Regent", "Seven Seas Splendor", "Explorer", 2020, "None", 55254, 750, false,
        "None", "Regent Suite", 4.0m,
        "Pool, spa", "Sister to Explorer; all-suite, all-inclusive",
        0, 93, 95, 95, 97, 0m),
    ["Seven Seas Grandeur"] = new("adult", "Regent", "Seven Seas Grandeur", "Explorer", 2023, "None", 55254, 750, false,
        "None", "Regent Suite", 4.0m,
        "Pool, spa", "Newest Explorer-class; all-suite ultra-luxury",
        0, 94, 96, 96, 98, 0m),
    ["Seven Seas Mariner"] = new("adult", "Regent", "Seven Seas Mariner", "Mariner", 2001, "2020", 48075, 700, false,
        "None", "Master Suite", 3.5m,
        "Pool, spa", "First all-suite, all-balcony cruise ship; world voyages",
        0, 86, 92, 92, 95, 0m),
    ["Seven Seas Navigator"] = new("adult", "Regent", "Seven Seas Navigator", "Navigator", 1999, "2020", 33000, 490, false,
        "None", "Master Suite", 3.5m,
        "Pool, spa", "Intimate luxury; 245 suites; world voyages",
        0, 82, 90, 90, 93, 0m),
    ["Seven Seas Prestige"] = new("adult", "Regent", "Seven Seas Prestige", "Explorer", 2026, "None", 55254, 750, false,
        "None", "Regent Suite", 4.0m,
        "Pool, spa", "Explorer-class; planned 2026 debut; all-suite",
        0, 94, 96, 96, 98, 0m),

    // SILVERSEA (adult-focused ultra-luxury, all-suite, all-inclusive)    SuiteName    Mult KidsR ShipR  MainDin PkgDin SuiteDin PkgCost
    ["Silver Nova"] = new("adult", "Silversea", "Silver Nova", "Nova", 2023, "None", 54700, 728, false,
        "None", "Suite", 2.5m,
        "Pool, spa", "Newest class; S.A.L.T. immersive culinary program; asymmetric design",
        0, 92, 88, 88, 92, 0m),
    ["Silver Ray"] = new("adult", "Silversea", "Silver Ray", "Nova", 2024, "None", 54700, 728, false,
        "None", "Suite", 2.5m,
        "Pool, spa", "Sister to Nova; latest S.A.L.T. culinary lab; all-suite ultra-luxury",
        0, 93, 88, 88, 92, 0m),
    ["Silver Dawn"] = new("adult", "Silversea", "Silver Dawn", "Muse", 2022, "None", 40700, 596, false,
        "None", "Suite", 2.5m,
        "Pool, spa", "Muse-class; intimate all-suite; strong Mediterranean & expedition program",
        0, 90, 87, 87, 91, 0m),
    ["Silver Moon"] = new("adult", "Silversea", "Silver Moon", "Muse", 2020, "None", 40700, 596, false,
        "None", "Suite", 2.5m,
        "Pool, spa", "S.A.L.T. culinary program debut ship; all-suite, 596 guests",
        0, 90, 87, 87, 91, 0m),
    ["Silver Muse"] = new("adult", "Silversea", "Silver Muse", "Muse", 2017, "2024", 40700, 596, false,
        "None", "Suite", 2.5m,
        "Pool, spa", "First Muse-class; 8 dining venues; all-suite ultra-luxury",
        0, 89, 86, 86, 90, 0m),
    ["Silver Spirit"] = new("adult", "Silversea", "Silver Spirit", "Spirit", 2009, "2018", 36009, 608, false,
        "None", "Suite", 2.5m,
        "Pool, spa", "Lengthened 2018; La Dame Relais & Châteaux; 304 suites",
        0, 85, 85, 85, 90, 0m),
    ["Silver Shadow"] = new("adult", "Silversea", "Silver Shadow", "Shadow", 2000, "2020", 28258, 382, false,
        "None", "Suite", 2.0m,
        "Pool, spa", "Intimate 382-guest ship; classic ocean voyages",
        0, 82, 84, 84, 88, 0m),
    ["Silver Whisper"] = new("adult", "Silversea", "Silver Whisper", "Shadow", 2001, "2023", 28258, 382, false,
        "None", "Suite", 2.0m,
        "Pool, spa", "Sister to Shadow; world cruise veteran; intimate luxury",
        0, 82, 84, 84, 88, 0m),
    ["Silver Wind"] = new("adult", "Silversea", "Silver Wind", "Wind", 1995, "2021", 17400, 296, false,
        "None", "Suite", 2.0m,
        "Pool, spa", "Most intimate ocean ship; 148 suites; expedition-convertible",
        0, 78, 82, 82, 86, 0m),
    ["Silver Cloud"] = new("adult", "Silversea", "Silver Cloud", "Wind", 1994, "2017", 17400, 296, false,
        "None", "Suite", 2.0m,
        "Pool, spa", "Converted to expedition 2017; ice-class hull; Zodiac excursions",
        0, 80, 82, 82, 86, 0m),
    ["Silver Endeavour"] = new("adult", "Silversea", "Silver Endeavour", "Endeavour", 2021, "None", 23000, 200, false,
        "None", "Suite", 2.5m,
        "Pool, spa", "Purpose-built expedition; Polar Class 6 hull; 200 guests; Antarctica specialist",
        0, 85, 86, 86, 90, 0m),
    ["Silver Origin"] = new("adult", "Silversea", "Silver Origin", "Origin", 2020, "None", 5800, 100, false,
        "None", "Suite", 2.0m,
        "Pool", "Galapagos-dedicated expedition ship; 100 guests; all-suite; immersive naturalist program",
        0, 84, 86, 86, 88, 0m),

    // VIRGIN VOYAGES (adults-only premium, all restaurants included, no buffet)  SuiteName    Mult KidsR ShipR  MainDin PkgDin SuiteDin PkgCost
    ["Scarlet Lady"] = new("adult", "Virgin Voyages", "Scarlet Lady", "Mega", 2021, "None", 110000, 2770, false,
        "None", "Rockstar Quarters", 3.0m,
        "Pool, Aquatic club, athletic club", "First Virgin ship; 20+ included restaurants; Richard's Rooftop; no buffet concept",
        0, 90, 90, 90, 94, 0m),
    ["Valiant Lady"] = new("adult", "Virgin Voyages", "Valiant Lady", "Mega", 2022, "None", 110000, 2770, false,
        "None", "Rockstar Quarters", 3.0m,
        "Pool, Aquatic club, athletic club", "Sister to Scarlet; sails Mediterranean and Caribbean; same 20+ restaurant concept",
        0, 90, 90, 90, 94, 0m),
    ["Resilient Lady"] = new("adult", "Virgin Voyages", "Resilient Lady", "Mega", 2023, "None", 110000, 2770, false,
        "None", "Rockstar Quarters", 3.0m,
        "Pool, Aquatic club, athletic club", "Third Mega-class; sails Greek Isles, Australia, and Caribbean rotations",
        0, 90, 90, 90, 94, 0m),
    ["Brilliant Lady"] = new("adult", "Virgin Voyages", "Brilliant Lady", "Mega", 2025, "None", 110000, 2770, false,
        "None", "Rockstar Quarters", 3.0m,
        "Pool, Aquatic club, athletic club", "Fourth Mega-class; enters service 2025; same dining and entertainment concept",
        0, 90, 90, 90, 94, 0m),

    // SEABOURN (adult-only ultra-luxury, all-suite, all-inclusive)        SuiteName    Mult KidsR ShipR  MainDin PkgDin SuiteDin PkgCost
    ["Seabourn Encore"] = new("adult", "Seabourn", "Seabourn Encore", "Encore", 2016, "2023", 40350, 604, false,
        "None", "Suite", 2.5m,
        "Pool, spa, whirlpools", "Newest ocean-class; The Grill by Thomas Keller; all-suite, all-inclusive",
        0, 90, 88, 88, 92, 0m),
    ["Seabourn Ovation"] = new("adult", "Seabourn", "Seabourn Ovation", "Encore", 2018, "None", 40350, 604, false,
        "None", "Suite", 2.5m,
        "Pool, spa, whirlpools", "Sister to Encore; The Grill by Thomas Keller; European/Asian focus",
        0, 91, 88, 88, 92, 0m),
    ["Seabourn Quest"] = new("adult", "Seabourn", "Seabourn Quest", "Odyssey", 2011, "2023", 32346, 458, false,
        "None", "Suite", 2.0m,
        "Pool, spa", "Odyssey-class; intimate all-suite; The Grill by Thomas Keller",
        0, 85, 86, 86, 90, 0m),
    ["Seabourn Sojourn"] = new("adult", "Seabourn", "Seabourn Sojourn", "Odyssey", 2010, "2022", 32346, 458, false,
        "None", "Suite", 2.0m,
        "Pool, spa", "World cruise specialist; The Grill by Thomas Keller; 229 suites",
        0, 84, 86, 86, 90, 0m),
    ["Seabourn Venture"] = new("adult", "Seabourn", "Seabourn Venture", "Venture", 2022, "None", 23000, 264, false,
        "None", "Suite", 2.5m,
        "Pool, spa", "Purpose-built expedition; PC6 ice-class hull; 2 submarines; 264 guests",
        0, 88, 87, 87, 91, 0m),
    ["Seabourn Pursuit"] = new("adult", "Seabourn", "Seabourn Pursuit", "Venture", 2023, "None", 23000, 264, false,
        "None", "Suite", 2.5m,
        "Pool, spa", "Sister to Venture; expedition with submarines; Arctic/Antarctic specialist",
        0, 88, 87, 87, 91, 0m),
};

ShipInfo? LookupShip(string name)
{
    if (ships.TryGetValue(name, out var info)) return info;
    var match = ships.FirstOrDefault(kv =>
        kv.Key.Contains(name, StringComparison.OrdinalIgnoreCase) ||
        name.Contains(kv.Key, StringComparison.OrdinalIgnoreCase));
    return match.Value;
}

// ════════════════════════════════════════════════════════════════════════
//  API ENDPOINTS
// ════════════════════════════════════════════════════════════════════════

// ── Restaurant Data (SQL loaded) ───────────────────────────────────────
var allRestaurants = new Dictionary<string, List<RestaurantData>>(StringComparer.OrdinalIgnoreCase);
try 
{
    using var conn = new SqlConnection(connectionString);
    var rows = conn.Query<RestaurantData>("SELECT Id, ShipName, Name, Type, Cuisine, Score, Why FROM Restaurants");
    var lookup = rows.GroupBy(r => r.ShipName, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);
    foreach (var kvp in lookup)
    {
        allRestaurants[kvp.Key] = kvp.Value;
    }
}
catch (Exception ex)
{
    Console.WriteLine("Failed to load restaurant data: " + ex.Message);
}

// Override the hardcoded ShipInfo with computed ratings
foreach (var shipName in ships.Keys.ToList())
{
    if (allRestaurants.TryGetValue(shipName, out var venues))
    {
        var included = venues.Where(v => v.Type == "Included").Select(v => v.Score).ToList();
        var mainScore = included.Any() ? included.Max() : 0;
        
        var specialty = venues.Where(v => v.Type.StartsWith("Specialty")).Select(v => v.Score).OrderByDescending(s => s).Take(3).ToList();
        var pkgScore = specialty.Any() ? (int)specialty.Average() : 0;
        
        var suite = venues.Where(v => v.Type.StartsWith("Suite")).Select(v => v.Score).ToList();
        var suiteScore = suite.Any() ? suite.Max() : 0;

        var old = ships[shipName];
        ships[shipName] = old with {
            MainDiningScore = mainScore > 0 ? mainScore : old.MainDiningScore,
            PackageDiningScore = pkgScore > 0 ? pkgScore : old.PackageDiningScore,
            SuiteDiningScore = suiteScore > 0 ? suiteScore : old.SuiteDiningScore
        };
    }
}

// GET /api/stats — Dashboard summary numbers
app.MapGet("/api/stats", async (string? appMode) =>
{
    using var conn = new SqlConnection(connectionString);
    var modeLines = LinesForMode(appMode);
    var lineFilter = string.Join(",", modeLines.Select(l => $"'{l}'"));
    var totalSailings = await conn.ExecuteScalarAsync<int>(
        $"SELECT COUNT(*) FROM Cruises WHERE DepartureDate >= CAST(GETDATE() AS DATE) AND CruiseLine IN ({lineFilter})");

    var stats = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
        ;WITH LatestScrapes AS (
            SELECT CruiseLine, MAX(ScrapedAt) as MaxScrapedAt
            FROM PriceHistory
            WHERE CruiseLine IN ({lineFilter})
            GROUP BY CruiseLine
        ),
        LatestPrices AS (
            SELECT ph.ShipName, ph.BalconyPerDay, ph.SuitePerDay,
                   ROW_NUMBER() OVER (PARTITION BY ph.CruiseLine, ph.ShipName, ph.DepartureDate ORDER BY ph.ScrapedAt DESC) AS rn
            FROM PriceHistory ph
            INNER JOIN Cruises c ON c.CruiseLine = ph.CruiseLine AND c.ShipName = ph.ShipName AND c.DepartureDate = ph.DepartureDate
            WHERE c.DepartureDate >= CAST(GETDATE() AS DATE) AND c.CruiseLine IN ({lineFilter})
              AND ph.ScrapedAt > DATEADD(hour, -36, (SELECT MaxScrapedAt FROM LatestScrapes ls WHERE ls.CruiseLine = c.CruiseLine))
        )
        SELECT
            COUNT(DISTINCT ShipName) AS Ships,
            MIN(CASE WHEN BalconyPerDay > 0 THEN BalconyPerDay END) AS CheapestBalconyPPD,
            MIN(CASE WHEN SuitePerDay > 0 THEN SuitePerDay END) AS CheapestSuitePPD
        FROM LatestPrices
        WHERE rn = 1");

    var latestScrape = await conn.ExecuteScalarAsync<DateTime?>(
        $"SELECT MAX(ScrapedAt) FROM PriceHistory WHERE CruiseLine IN ({lineFilter})");

    // Scraper health: latest run per scraper from ScraperRuns table
    object? scraperHealth = null;
    try
    {
        var latestRuns = (await conn.QueryAsync<dynamic>(@"
            SELECT ScraperName, StartedAt, CompletedAt, SailingsFound, SailingsUpdated, Status, Errors
            FROM ScraperRuns sr
            WHERE CompletedAt = (SELECT MAX(CompletedAt) FROM ScraperRuns WHERE ScraperName = sr.ScraperName)
            ORDER BY ScraperName")).ToList();
        if (latestRuns.Count > 0)
        {
            scraperHealth = latestRuns.Select(r => new
            {
                ScraperName = (string)r.ScraperName,
                CompletedAt = DateTime.SpecifyKind((DateTime)r.CompletedAt, DateTimeKind.Utc).ToString("o"),
                SailingsFound = (int)r.SailingsFound,
                SailingsUpdated = (int)r.SailingsUpdated,
                Status = (string)r.Status,
                Errors = (string?)r.Errors
            }).ToList();
        }
    }
    catch { /* ScraperRuns table may not exist yet */ }

    return Results.Ok(new
    {
        TotalSailings = totalSailings,
        UniqueShips = (int)(stats?.Ships ?? 0),
        CheapestBalconyPPD = (decimal?)(stats?.CheapestBalconyPPD),
        CheapestSuitePPD = (decimal?)(stats?.CheapestSuitePPD),
        LastScraped = latestScrape.HasValue
            ? DateTime.SpecifyKind(latestScrape.Value, DateTimeKind.Utc).ToString("o")
            : null,
        ScraperHealth = scraperHealth
    });
});

// Helper: get cruise lines for a given app mode category
string[] LinesForMode(string? appMode) => appMode == "adult"
    ? ships.Values.Where(s => s.Category == "adult").Select(s => s.CruiseLine).Distinct().ToArray()
    : ships.Values.Where(s => s.Category == "family").Select(s => s.CruiseLine).Distinct().ToArray();

// GET /api/filter-options — Distinct ship names and ports for multi-select filters
app.MapGet("/api/filter-options", async (string? appMode) =>
{
    using var conn = new SqlConnection(connectionString);
    var modeLines = LinesForMode(appMode);
    var lineList = string.Join(",", modeLines.Select(l => $"'{l}'"));
    var whereClause = $"WHERE DepartureDate >= CAST(GETDATE() AS DATE) AND CruiseLine IN ({lineList})";
    var lines = (await conn.QueryAsync<string>(
        $"SELECT DISTINCT CruiseLine FROM Cruises {whereClause} ORDER BY CruiseLine")).ToList();
    var shipNames = (await conn.QueryAsync<string>(
        $"SELECT DISTINCT ShipName FROM Cruises {whereClause} ORDER BY ShipName")).ToList();
    var ports = (await conn.QueryAsync<string>(
        $"SELECT DISTINCT DeparturePort FROM Cruises {whereClause} ORDER BY DeparturePort")).ToList();
    return Results.Ok(new { lines, ships = shipNames, ports });
});

// GET /api/cruises?line=Disney&ship=&port=&sortBy=departureDate&sortDir=asc&appMode=family
app.MapGet("/api/cruises", async (string? line, string? ship, string? port, string? sortBy, string? sortDir, string? mode, string? appMode) =>
{
    using var conn = new SqlConnection(connectionString);
    var sql = @"
        WITH LatestScrapes AS (
            SELECT CruiseLine, MAX(ScrapedAt) as MaxScrapedAt
            FROM PriceHistory
            GROUP BY CruiseLine
        )
        SELECT
            c.CruiseLine, c.ShipName, c.Itinerary, c.ItineraryCode, c.DepartureDate, c.Nights, c.DeparturePort, c.Ports,
            p.InsidePrice, p.InsidePerDay, p.OceanviewPrice, p.OceanviewPerDay,
            p.BalconyPrice, p.BalconyPerDay, p.SuitePrice, p.SuitePerDay, p.ScrapedAt,
            p.FamilyInsidePrice, p.FamilyInsidePerDay, p.FamilyOceanviewPrice, p.FamilyOceanviewPerDay,
            p.FamilyBalconyPrice, p.FamilyBalconyPerDay, p.FamilySuitePrice, p.FamilySuitePerDay,
            fl.FLResBalconyPrice, fl.FLResBalconyPerDay, fl.FLResSuitePrice, fl.FLResSuitePerDay, fl.FLResScrapedAt
        FROM Cruises c
        OUTER APPLY (
            SELECT TOP 1 ph.InsidePrice, ph.InsidePerDay, ph.OceanviewPrice, ph.OceanviewPerDay,
                   ph.BalconyPrice, ph.BalconyPerDay, ph.SuitePrice, ph.SuitePerDay, ph.ScrapedAt,
                   ph.FamilyInsidePrice, ph.FamilyInsidePerDay, ph.FamilyOceanviewPrice, ph.FamilyOceanviewPerDay,
                   ph.FamilyBalconyPrice, ph.FamilyBalconyPerDay, ph.FamilySuitePrice, ph.FamilySuitePerDay
            FROM PriceHistory ph
            WHERE ph.CruiseLine = c.CruiseLine AND ph.ShipName = c.ShipName AND ph.DepartureDate = c.DepartureDate
            ORDER BY ph.ScrapedAt DESC
        ) p
        OUTER APPLY (
            SELECT TOP 1 ph2.FLResBalconyPrice, ph2.FLResBalconyPerDay, ph2.FLResSuitePrice, ph2.FLResSuitePerDay, ph2.ScrapedAt AS FLResScrapedAt
            FROM PriceHistory ph2
            WHERE ph2.CruiseLine = c.CruiseLine AND ph2.ShipName = c.ShipName AND ph2.DepartureDate = c.DepartureDate
              AND (ph2.FLResBalconyPrice IS NOT NULL OR ph2.FLResSuitePrice IS NOT NULL)
            ORDER BY ph2.ScrapedAt DESC
        ) fl
        WHERE c.IsDeparted = 0 AND c.DepartureDate >= CAST(GETDATE() AS DATE)
          AND (
              p.ScrapedAt > DATEADD(hour, -36, (SELECT MaxScrapedAt FROM LatestScrapes ls WHERE ls.CruiseLine = c.CruiseLine))
              OR 
              fl.FLResScrapedAt > DATEADD(hour, -36, (SELECT MaxScrapedAt FROM LatestScrapes ls WHERE ls.CruiseLine = c.CruiseLine))
          )";

    // Suite mode: exclude cruises with no suite pricing at all
    if (string.Equals(mode, "suite", StringComparison.OrdinalIgnoreCase))
    {
        sql += " AND ISNULL(p.VerifiedSuitePerDay, 0) > 0";
    }

    // App mode: filter by cruise line category
    var modeLines = LinesForMode(appMode);
    sql += $" AND c.CruiseLine IN ({string.Join(",", modeLines.Select(l => $"'{l}'"))})";

    if (!string.IsNullOrEmpty(line)) sql += " AND c.CruiseLine = @line";
    if (!string.IsNullOrEmpty(ship)) sql += " AND c.ShipName LIKE '%' + @ship + '%'";
    if (!string.IsNullOrEmpty(port)) sql += " AND c.DeparturePort LIKE '%' + @port + '%'";

    sql += (sortBy?.ToLower(), sortDir?.ToLower()) switch
    {
        ("ship", "desc") => " ORDER BY c.ShipName DESC",
        ("ship", _) => " ORDER BY c.ShipName ASC",
        ("balcony", "desc") => " ORDER BY p.BalconyPerDay DESC",
        ("balcony", _) => " ORDER BY p.BalconyPerDay ASC",
        ("suite", "desc") => " ORDER BY p.SuitePerDay DESC",
        ("suite", _) => " ORDER BY p.SuitePerDay ASC",
        ("nights", "desc") => " ORDER BY c.Nights DESC",
        ("nights", _) => " ORDER BY c.Nights ASC",
        ("port", _) => " ORDER BY c.DeparturePort ASC",
        (_, "desc") => " ORDER BY c.DepartureDate DESC",
        _ => " ORDER BY c.DepartureDate ASC"
    };

    var rows = await conn.QueryAsync<dynamic>(sql, new { line, ship, port });
    var result = rows.Select(r =>
    {
        var si = LookupShip((string)r.ShipName);
        return new
        {
            CruiseLine = (string)r.CruiseLine,
            ShipName = (string)r.ShipName,
            ShipClass = si?.ShipClass ?? "Unknown",
            YearBuilt = si?.YearBuilt ?? 0,
            LastRenovated = si?.LastRenovated ?? "",
            SuiteName = si?.SuiteName ?? "?",
            HasKids = si?.HasKidsArea ?? false,
            Itinerary = (string)(r.Itinerary ?? ""),
            ItineraryCode = (string)(r.ItineraryCode ?? ""),
            DepartureDate = ((DateTime)r.DepartureDate).ToString("yyyy-MM-dd"),
            Nights = (int)(r.Nights ?? 0),
            DeparturePort = (string)(r.DeparturePort ?? ""),
            Ports = (string)(r.Ports ?? ""),
            BalconyPrice = (decimal?)(r.BalconyPrice),
            BalconyPerDay = (decimal?)(r.BalconyPerDay),
            SuitePrice = (decimal?)(r.SuitePrice),
            SuitePerDay = (decimal?)(r.SuitePerDay),
            InsidePrice = (decimal?)(r.InsidePrice),
            InsidePerDay = (decimal?)(r.InsidePerDay),
            OceanviewPrice = (decimal?)(r.OceanviewPrice),
            OceanviewPerDay = (decimal?)(r.OceanviewPerDay),

            FamilyInsidePrice = (decimal?)(r.FamilyInsidePrice),
            FamilyInsidePerDay = (decimal?)(r.FamilyInsidePerDay),
            FamilyOceanviewPrice = (decimal?)(r.FamilyOceanviewPrice),
            FamilyOceanviewPerDay = (decimal?)(r.FamilyOceanviewPerDay),
            FamilyBalconyPrice = (decimal?)(r.FamilyBalconyPrice),
            FamilyBalconyPerDay = (decimal?)(r.FamilyBalconyPerDay),
            FamilySuitePrice = (decimal?)(r.FamilySuitePrice),
            FamilySuitePerDay = (decimal?)(r.FamilySuitePerDay),

            FLResBalconyPrice = (decimal?)(r.FLResBalconyPrice),
            FLResBalconyPerDay = (decimal?)(r.FLResBalconyPerDay),
            FLResSuitePrice = (decimal?)(r.FLResSuitePrice),
            FLResSuitePerDay = (decimal?)(r.FLResSuitePerDay),
            FLResScrapedAt = r.FLResScrapedAt != null ? ((DateTime)r.FLResScrapedAt).ToString("yyyy-MM-dd HH:mm") : null,

            KidsScore = si?.KidsScore ?? 0,
            ShipScore = si?.ShipScore ?? 0,
            MainDiningScore = si?.MainDiningScore ?? 0,
            PackageDiningScore = si?.PackageDiningScore ?? 0,
            SuiteDiningScore = si?.SuiteDiningScore ?? 0,
            DiningPackageCostPerDay = si?.DiningPackageCostPerDay ?? 0m,
            ScrapedAt = r.ScrapedAt != null ? ((DateTime)r.ScrapedAt).ToString("yyyy-MM-dd HH:mm") : null
        };
    });

    return Results.Ok(result);
});

// PUT /api/ship-rating/{shipName} — Update a ship's rating
app.MapPut("/api/ship-rating/{shipName}", (string shipName, RatingUpdate body) =>
{
    var key = ships.Keys.FirstOrDefault(k => k.Equals(shipName, StringComparison.OrdinalIgnoreCase));
    if (key == null) return Results.NotFound();
    var old = ships[key];
    ships[key] = old with {
        KidsScore = body.KidsScore ?? old.KidsScore,
        ShipScore = body.ShipScore ?? old.ShipScore,
        MainDiningScore = body.MainDiningScore ?? old.MainDiningScore,
        PackageDiningScore = body.PackageDiningScore ?? old.PackageDiningScore,
        SuiteDiningScore = body.SuiteDiningScore ?? old.SuiteDiningScore
    };
    return Results.Ok(new {
        shipName = key,
        kidsScore = ships[key].KidsScore,
        shipScore = ships[key].ShipScore,
        mainDiningScore = ships[key].MainDiningScore,
        packageDiningScore = ships[key].PackageDiningScore,
        suiteDiningScore = ships[key].SuiteDiningScore
    });
});

// GET /api/restaurants/{shipName} — Get detailed dining evaluations
app.MapGet("/api/restaurants/{shipName}", (string shipName) =>
{
    var key = allRestaurants.Keys.FirstOrDefault(k => k.Equals(shipName, StringComparison.OrdinalIgnoreCase));
    if (key == null) return Results.Ok(new List<RestaurantData>()); // Return empty array if not found
    return Results.Ok(allRestaurants[key]);
});

// PUT /api/restaurants/{id} — Update a specific restaurant
app.MapPut("/api/restaurants/{id}", async (int id, RestaurantData body) =>
{
    using var conn = new SqlConnection(connectionString);
    var sql = "UPDATE Restaurants SET Score = @Score, Why = @Why WHERE Id = @Id; SELECT ShipName FROM Restaurants WHERE Id = @Id;";
    var shipName = await conn.ExecuteScalarAsync<string>(sql, new { body.Score, body.Why, Id = id });
    
    if (shipName == null) return Results.NotFound();

    // Update memory cache
    if (allRestaurants.TryGetValue(shipName, out var venues))
    {
        var idx = venues.FindIndex(r => r.Id == id);
        if (idx >= 0)
        {
            venues[idx] = venues[idx] with { Score = body.Score, Why = body.Why };
        }

        // Recalculate ship scores
        var included = venues.Where(v => v.Type == "Included").Select(v => v.Score).ToList();
        var mainScore = included.Any() ? included.Max() : 0;
        
        var specialty = venues.Where(v => v.Type.StartsWith("Specialty")).Select(v => v.Score).OrderByDescending(s => s).Take(3).ToList();
        var pkgScore = specialty.Any() ? (int)specialty.Average() : 0;
        
        var suite = venues.Where(v => v.Type.StartsWith("Suite")).Select(v => v.Score).ToList();
        var suiteScore = suite.Any() ? suite.Max() : 0;

        var key = ships.Keys.FirstOrDefault(k => k.Equals(shipName, StringComparison.OrdinalIgnoreCase));
        if (key != null)
        {
            var old = ships[key];
            ships[key] = old with {
                MainDiningScore = mainScore > 0 ? mainScore : old.MainDiningScore,
                PackageDiningScore = pkgScore > 0 ? pkgScore : old.PackageDiningScore,
                SuiteDiningScore = suiteScore > 0 ? suiteScore : old.SuiteDiningScore
            };
        }
    }
    return Results.Ok();
});

// GET /api/price-history/{cruiseLine}/{shipName}/{departureDate}
app.MapGet("/api/price-history/{cruiseLine}/{shipName}/{departureDate}", async (string cruiseLine, string shipName, string departureDate) =>
{
    using var conn = new SqlConnection(connectionString);
    var rows = await conn.QueryAsync<dynamic>(@"
        SELECT ScrapedAt, BalconyPrice, BalconyPerDay, SuitePrice, SuitePerDay,
               InsidePrice, InsidePerDay, OceanviewPrice, OceanviewPerDay,
               FLResBalconyPrice, FLResBalconyPerDay, FLResSuitePrice, FLResSuitePerDay,
               FamilyInsidePrice, FamilyInsidePerDay, FamilyOceanviewPrice, FamilyOceanviewPerDay,
               FamilyBalconyPrice, FamilyBalconyPerDay, FamilySuitePrice, FamilySuitePerDay,
               FamilySuitePrice, FamilySuitePerDay
        FROM PriceHistory
        WHERE CruiseLine = @cruiseLine AND ShipName = @shipName AND DepartureDate = @departureDate
        ORDER BY ScrapedAt ASC",
        new { cruiseLine, shipName, departureDate });

    return Results.Ok(rows.Select(r => new
    {
        ScrapedAt = ((DateTime)r.ScrapedAt).ToString("yyyy-MM-dd HH:mm"),
        BalconyPrice = (decimal?)r.BalconyPrice,
        BalconyPerDay = (decimal?)r.BalconyPerDay,
        SuitePrice = (decimal?)r.SuitePrice,
        SuitePerDay = (decimal?)r.SuitePerDay,
        InsidePrice = (decimal?)r.InsidePrice,
        InsidePerDay = (decimal?)r.InsidePerDay,
        OceanviewPrice = (decimal?)r.OceanviewPrice,
        OceanviewPerDay = (decimal?)r.OceanviewPerDay,
        FLResBalconyPrice = (decimal?)r.FLResBalconyPrice,
        FLResBalconyPerDay = (decimal?)r.FLResBalconyPerDay,
        FLResSuitePrice = (decimal?)r.FLResSuitePrice,
        FLResSuitePerDay = (decimal?)r.FLResSuitePerDay,
        FamilyInsidePrice = (decimal?)r.FamilyInsidePrice,
        FamilyInsidePerDay = (decimal?)r.FamilyInsidePerDay,
        FamilyOceanviewPrice = (decimal?)r.FamilyOceanviewPrice,
        FamilyOceanviewPerDay = (decimal?)r.FamilyOceanviewPerDay,
        FamilyBalconyPrice = (decimal?)r.FamilyBalconyPrice,
        FamilyBalconyPerDay = (decimal?)r.FamilyBalconyPerDay,
        FamilySuitePrice = (decimal?)r.FamilySuitePrice,
        FamilySuitePerDay = (decimal?)r.FamilySuitePerDay,

    }));
});

// GET /api/ships — full fleet reference
app.MapGet("/api/ships", () =>
{
    return Results.Ok(ships.Values.OrderBy(s => s.CruiseLine).ThenBy(s => s.YearBuilt));
});

// GET /api/deals — cruises at or below alert thresholds
app.MapGet("/api/deals", async () =>
{
    var thresholds = new Dictionary<string, (decimal Balcony, decimal Suite)>
    {
        ["Disney"] = (300m, 500m),
        ["Norwegian"] = (150m, 250m)
    };

    using var conn = new SqlConnection(connectionString);
    var rows = await conn.QueryAsync<dynamic>(@"
        SELECT
            c.CruiseLine, c.ShipName, c.Itinerary, c.DepartureDate, c.Nights, c.DeparturePort,
            p.BalconyPrice, p.BalconyPerDay, p.SuitePrice, p.SuitePerDay
        FROM Cruises c
        OUTER APPLY (
            SELECT TOP 1 ph.BalconyPrice, ph.BalconyPerDay, ph.SuitePrice, ph.SuitePerDay
            FROM PriceHistory ph
            WHERE ph.CruiseLine = c.CruiseLine AND ph.ShipName = c.ShipName AND ph.DepartureDate = c.DepartureDate
            ORDER BY ph.ScrapedAt DESC
        ) p
        WHERE c.DepartureDate >= CAST(GETDATE() AS DATE)
        ORDER BY p.BalconyPerDay ASC");

    var deals = rows.Where(r =>
    {
        var line = (string)r.CruiseLine;
        if (!thresholds.ContainsKey(line)) return false;
        var (bThresh, sThresh) = thresholds[line];
        var bpd = (decimal?)(r.BalconyPerDay) ?? 999999;
        var spd = (decimal?)(r.SuitePerDay) ?? 999999;
        return bpd <= bThresh || spd <= sThresh;
    }).Select(r =>
    {
        var si = LookupShip((string)r.ShipName);
        var line = (string)r.CruiseLine;
        var (bThresh, sThresh) = thresholds[line];
        var bpd = (decimal?)(r.BalconyPerDay);
        var spd = (decimal?)(r.SuitePerDay);
        var sPrice = (decimal?)(r.SuitePrice);
        return new
        {
            CruiseLine = line,
            ShipName = (string)r.ShipName,
            ShipClass = si?.ShipClass ?? "?",
            SuiteName = si?.SuiteName ?? "?",
            Itinerary = (string)(r.Itinerary ?? ""),
            DepartureDate = ((DateTime)r.DepartureDate).ToString("yyyy-MM-dd"),
            Nights = (int)(r.Nights ?? 0),
            DeparturePort = (string)(r.DeparturePort ?? ""),
            BalconyPrice = (decimal?)(r.BalconyPrice),
            BalconyPerDay = bpd,
            SuitePrice = sPrice,
            SuitePerDay = spd,
            IsBalconyDeal = bpd.HasValue && bpd <= bThresh,
            IsSuiteDeal = spd.HasValue && spd <= sThresh,
            DealType = (bpd.HasValue && bpd <= bThresh ? "Balcony" : "") +
                       (bpd.HasValue && bpd <= bThresh && spd.HasValue && spd <= sThresh ? " + " : "") +
                       (spd.HasValue && spd <= sThresh ? "Suite" : "")
        };
    });

    return Results.Ok(deals);
});

// GET /api/hot-deals — cruises with exceptional value (multi-signal heat scoring)
app.MapGet("/api/hot-deals", async (string? appMode) =>
{
    using var conn = new SqlConnection(connectionString);
    var modeLines = LinesForMode(appMode);
    var lineFilter = string.Join(",", modeLines.Select(l => $"'{l}'"));

    // Single query: current prices + price history stats (peak, snapshot count)
    var rows = await conn.QueryAsync<dynamic>($@"
        WITH LatestScrapes AS (
            SELECT CruiseLine, MAX(ScrapedAt) as MaxScrapedAt
            FROM PriceHistory
            GROUP BY CruiseLine
        )
        SELECT
            c.CruiseLine, c.ShipName, c.Itinerary, c.ItineraryCode, c.DepartureDate, c.Nights, c.DeparturePort, c.Ports,
            p.BalconyPrice, p.BalconyPerDay, p.SuitePrice, p.SuitePerDay, p.ScrapedAt,
            hist.PeakPpd, hist.LowestPpd, hist.Snapshots
        FROM Cruises c
        OUTER APPLY (
            SELECT TOP 1 ph.BalconyPrice, ph.BalconyPerDay, ph.SuitePrice, ph.SuitePerDay, ph.ScrapedAt
            FROM PriceHistory ph
            WHERE ph.CruiseLine = c.CruiseLine AND ph.ShipName = c.ShipName AND ph.DepartureDate = c.DepartureDate
            ORDER BY ph.ScrapedAt DESC
        ) p
        OUTER APPLY (
            SELECT MAX(ph2.BalconyPerDay) AS PeakPpd, MIN(ph2.BalconyPerDay) AS LowestPpd, COUNT(*) AS Snapshots
            FROM PriceHistory ph2
            WHERE ph2.CruiseLine = c.CruiseLine AND ph2.ShipName = c.ShipName AND ph2.DepartureDate = c.DepartureDate
              AND ph2.BalconyPerDay > 0
        ) hist
        WHERE c.IsDeparted = 0 AND c.DepartureDate >= CAST(GETDATE() AS DATE)
          AND c.CruiseLine IN ({lineFilter})
          AND p.BalconyPerDay > 0
          AND p.ScrapedAt > DATEADD(hour, -36, (SELECT MaxScrapedAt FROM LatestScrapes ls WHERE ls.CruiseLine = c.CruiseLine))
    ");

    var allRows = rows.ToList();
    if (allRows.Count == 0) return Results.Ok(Array.Empty<object>());

    // Compute per-line, per-nights-bucket percentiles (P10, P25)
    string NightsBucket(int n) => n <= 4 ? "3-4" : n <= 6 ? "5-6" : n <= 8 ? "7-8" : n <= 11 ? "9-11" : "12+";

    var peerGroups = allRows
        .GroupBy(r => $"{(string)r.CruiseLine}|{NightsBucket((int)(r.Nights ?? 7))}")
        .ToDictionary(
            g => g.Key,
            g =>
            {
                var prices = g.Select(r => (decimal)r.BalconyPerDay).OrderBy(p => p).ToList();
                var cnt = prices.Count;
                return new
                {
                    P10 = prices[(int)(cnt * 0.10)],
                    P25 = prices[(int)(cnt * 0.25)],
                    Median = prices[(int)(cnt * 0.50)],
                    Count = cnt
                };
            });

    // Compute per-line quality percentiles (ship + dining quality)
    var lineQualityThresholds = allRows
        .GroupBy(r => (string)r.CruiseLine)
        .ToDictionary(
            g => g.Key,
            g =>
            {
                var quals = g.Select(r =>
                {
                    var si = LookupShip((string)r.ShipName);
                    return (si?.ShipScore ?? 50) + (si?.MainDiningScore ?? 50);
                }).OrderBy(q => q).ToList();
                var cnt = quals.Count;
                return new { Top30 = quals[(int)(cnt * 0.70)], Count = cnt };
            });

    var linePriceP30 = allRows
        .GroupBy(r => (string)r.CruiseLine)
        .ToDictionary(
            g => g.Key,
            g =>
            {
                var prices = g.Select(r => (decimal)r.BalconyPerDay).OrderBy(p => p).ToList();
                return prices[(int)(prices.Count * 0.30)];
            });

    // Score each cruise
    var scored = allRows.Select(r =>
    {
        var line = (string)r.CruiseLine;
        var shipName = (string)r.ShipName;
        var ppd = (decimal)r.BalconyPerDay;
        var nights = (int)(r.Nights ?? 7);
        var si = LookupShip(shipName);
        var heatScore = 0;
        var reasons = new List<string>();

        // Signal 1: Price Drop from peak
        var snapshots = (int)(r.Snapshots ?? 0);
        var peakPpd = (decimal?)(r.PeakPpd);
        if (snapshots >= 3 && peakPpd.HasValue && peakPpd > 0)
        {
            var dropPct = (double)(1m - ppd / peakPpd.Value) * 100;
            if (dropPct >= 30)
            {
                heatScore += 2;
                reasons.Add($"📉 {(int)dropPct}% price drop from peak (${(int)peakPpd}/ppd → ${(int)ppd})");
            }
            else if (dropPct >= 15)
            {
                heatScore += 1;
                reasons.Add($"📉 {(int)dropPct}% price drop from peak");
            }
        }

        // Signal 2: Peer Outlier (below line+nights percentile)
        var bucket = NightsBucket(nights);
        var key = $"{line}|{bucket}";
        if (peerGroups.TryGetValue(key, out var peer) && peer.Count >= 5)
        {
            if (ppd <= peer.P10)
            {
                heatScore += 2;
                reasons.Add($"📊 Bottom 10% for {nights}-night {line} (${(int)ppd} vs median ${(int)peer.Median})");
            }
            else if (ppd <= peer.P25)
            {
                heatScore += 1;
                reasons.Add($"📊 Bottom 25% for {nights}-night {line}");
            }
        }

        // Signal 3: Quality-Price Gap
        if (si != null)
        {
            var qualScore = si.ShipScore + si.MainDiningScore;
            var topQuality = lineQualityThresholds.TryGetValue(line, out var lq) && qualScore >= lq.Top30;
            var lowPrice = linePriceP30.TryGetValue(line, out var lp) && ppd <= lp;

            if (topQuality && lowPrice)
            {
                var shipQ = si.ShipScore;
                var dinQ = si.MainDiningScore;
                if (ppd <= (linePriceP30.GetValueOrDefault(line, 999) * 0.70m))
                {
                    heatScore += 2;
                    reasons.Add($"🏆 Top-tier ship (ship:{shipQ} dining:{dinQ}) at rock-bottom price");
                }
                else
                {
                    heatScore += 1;
                    reasons.Add($"🏆 Top-tier ship (ship:{shipQ} dining:{dinQ}) at below-average price");
                }
            }
        }

        return new
        {
            HeatScore = heatScore,
            HeatReasons = reasons,
            CruiseLine = line,
            ShipName = shipName,
            ShipClass = si?.ShipClass ?? "Unknown",
            SuiteName = si?.SuiteName ?? "?",
            HasKids = si?.HasKidsArea ?? false,
            Itinerary = (string)(r.Itinerary ?? ""),
            ItineraryCode = (string)(r.ItineraryCode ?? ""),
            DepartureDate = ((DateTime)r.DepartureDate).ToString("yyyy-MM-dd"),
            Nights = nights,
            DeparturePort = (string)(r.DeparturePort ?? ""),
            BalconyPrice = (decimal?)(r.BalconyPrice),
            BalconyPerDay = ppd,
            SuitePrice = (decimal?)(r.SuitePrice),
            SuitePerDay = (decimal?)(r.SuitePerDay),
            KidsScore = si?.KidsScore ?? 0,
            ShipScore = si?.ShipScore ?? 0,
            MainDiningScore = si?.MainDiningScore ?? 0,
            PeakPpd = peakPpd,
            Snapshots = snapshots,
            ScrapedAt = r.ScrapedAt != null ? ((DateTime)r.ScrapedAt).ToString("yyyy-MM-dd HH:mm") : null
        };
    })
    .Where(x => x.HeatScore >= 3)
    .OrderByDescending(x => x.HeatScore)
    .ThenBy(x => x.BalconyPerDay)
    .Take(30)
    .ToList();

    return Results.Ok(scored);
});

// Fallback: serve index.html for SPA-like routing
app.MapFallbackToFile("index.html");

// ── Calendar Events (JSON persistence — reads from disk each request) ────
// Uses ContentRootPath so it always points to the git-tracked source file.
// No in-memory cache: edits to the file are reflected immediately.
var calendarJsonPath = Path.Combine(env.ContentRootPath, "calendar-events.json");
var calendarJsonOpts = new System.Text.Json.JsonSerializerOptions
{
    PropertyNameCaseInsensitive = true,
    WriteIndented = true
};

List<CalendarEvent> LoadCalendarEvents()
{
    if (!File.Exists(calendarJsonPath)) return new();
    try
    {
        var json = File.ReadAllText(calendarJsonPath);
        return System.Text.Json.JsonSerializer.Deserialize<List<CalendarEvent>>(json, calendarJsonOpts) ?? new();
    }
    catch { return new(); }
}

void SaveCalendarEvents(List<CalendarEvent> events)
{
    var json = System.Text.Json.JsonSerializer.Serialize(events, calendarJsonOpts);
    File.WriteAllText(calendarJsonPath, json);
}

app.MapGet("/api/calendar-events", () => Results.Ok(LoadCalendarEvents()));

app.MapPost("/api/calendar-events", (CalendarEvent evt) =>
{
    var events = LoadCalendarEvents();
    var newEvt = evt with { Id = Guid.NewGuid().ToString("N")[..8] };
    events.Add(newEvt);
    SaveCalendarEvents(events);
    return Results.Ok(newEvt);
});

app.MapDelete("/api/calendar-events/{id}", (string id) =>
{
    var events = LoadCalendarEvents();
    var removed = events.RemoveAll(e => e.Id == id);
    if (removed == 0) return Results.NotFound();
    SaveCalendarEvents(events);
    return Results.Ok();
});

app.MapPut("/api/calendar-events/{id}", (string id, CalendarEvent evt) =>
{
    var events = LoadCalendarEvents();
    var idx = events.FindIndex(e => e.Id == id);
    if (idx < 0) return Results.NotFound();
    events[idx] = evt with { Id = id };
    SaveCalendarEvents(events);
    return Results.Ok(events[idx]);
});

// ── Settings persistence (JSON file) ──────────────────────────────────
var settingsPath = Path.Combine(env.ContentRootPath, "dashboard-settings.json");

Dictionary<string, object> LoadSettings()
{
    if (!File.Exists(settingsPath)) return new Dictionary<string, object>();
    var json = File.ReadAllText(settingsPath);
    return System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object>>(json)
        ?? new Dictionary<string, object>();
}

void SaveSettings(Dictionary<string, object> settings)
{
    var json = System.Text.Json.JsonSerializer.Serialize(settings,
        new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
    File.WriteAllText(settingsPath, json);
}

app.MapGet("/api/settings", () => Results.Ok(LoadSettings()));

app.MapPost("/api/settings", async (HttpRequest request) =>
{
    var body = await System.Text.Json.JsonSerializer.DeserializeAsync<Dictionary<string, object>>(request.Body);
    if (body == null) return Results.BadRequest();
    var settings = LoadSettings();
    foreach (var kvp in body)
        settings[kvp.Key] = kvp.Value;
    SaveSettings(settings);
    return Results.Ok(settings);
});

app.Run();

// ── Records ─────────────────────────────────────────────────────────────
record ShipInfo(
    string Category, string CruiseLine, string ShipName, string ShipClass,
    int YearBuilt, string LastRenovated, int GrossTonnage, int PassengerCapacity,
    bool HasKidsArea, string KidsProgram, string SuiteName, decimal SuiteMultiplier,
    string WaterFeatures, string FamilyNotes,
    int KidsScore, int ShipScore,
    int MainDiningScore, int PackageDiningScore, int SuiteDiningScore,
    decimal DiningPackageCostPerDay);

record RatingUpdate(int? KidsScore, int? ShipScore,
    int? MainDiningScore, int? PackageDiningScore, int? SuiteDiningScore);

record CalendarEvent(string Id, string StartDate, string EndDate, string Type, string Title);

record RestaurantData(int Id, string ShipName, string Name, string Type, string Cuisine, int Score, string Why);
