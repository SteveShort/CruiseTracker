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
    ["Disney Magic"] = new("Disney", "Disney Magic", "Magic", 1998, "2023", 83969, 2713, true,
        "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)", "Concierge", 0m,
        "AquaDunk water slide, 3 pools", "Smallest Disney ship; classic feel; great for short itineraries",
        85, 78, 82, 88, 0, 16m),
    ["Disney Wonder"] = new("Disney", "Disney Wonder", "Magic", 1999, "2019", 83969, 2713, true,
        "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)", "Concierge", 0m,
        "Twist 'n' Spout slide, 3 pools", "Sister to Magic; sails Pacific/Alaska primarily",
        85, 78, 82, 88, 0, 16m),
    ["Disney Dream"] = new("Disney", "Disney Dream", "Dream", 2011, "2022", 129690, 4000, true,
        "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)", "Concierge", 0m,
        "AquaDuck water coaster, Nemo's Reef splash zone", "First AquaDuck ship; excellent for Bahamas from Port Canaveral",
        92, 85, 85, 92, 0, 25m),
    ["Disney Fantasy"] = new("Disney", "Disney Fantasy", "Dream", 2012, "2023", 129690, 4000, true,
        "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17)", "Concierge", 0m,
        "AquaDuck water coaster, AquaLab splash zone", "Same layout as Dream; sails 7-night Caribbean from Port Canaveral",
        95, 85, 85, 92, 0, 25m),
    ["Disney Wish"] = new("Disney", "Disney Wish", "Wish (Triton)", 2022, "None", 144000, 4000, true,
        "Oceaneer Club w/ slide entrance (3-10), Edge (11-14), Vibe (14-17), Hideaway", "Concierge", 0m,
        "AquaMouse water ride, 6 pools, Toy Story splash zone", "Grand Hall with Rapunzel theme; most dining venues of any Disney ship",
        98, 98, 88, 95, 0, 28m),
    ["Disney Treasure"] = new("Disney", "Disney Treasure", "Wish (Triton)", 2024, "None", 144000, 4000, true,
        "Oceaneer Club w/ slide entrance (3-10), Edge (11-14), Vibe (14-17), Hideaway", "Concierge", 0m,
        "AquaMouse water ride, 6 pools", "Adventure-themed; Moana/Coco Grand Hall; newest Disney ship sailing",
        98, 98, 88, 95, 0, 28m),
    ["Disney Destiny"] = new("Disney", "Disney Destiny", "Wish (Triton)", 2025, "None", 144000, 4000, true,
        "Oceaneer Club (3-10), Edge (11-14), Vibe (14-17), Hideaway", "Concierge", 0m,
        "AquaMouse water ride, 6 pools", "Heroes & Villains theme; enters service Nov 2025; sails from Ft Lauderdale",
        98, 98, 88, 95, 0, 28m),

    // NORWEGIAN                                                      SuiteName    Mult  KidsR ShipR  MainDin PkgDin SuiteDin PkgCost
    ["Norwegian Prima"] = new("Norwegian", "Norwegian Prima", "Prima", 2022, "None", 142500, 3215, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.4m,
        "Tidal Wave slide, Aqua Park drop slides, Infinity pool", "First Prima class; Haven sundeck + infinity pool; Galaxy Pavilion VR",
        85, 95, 78, 92, 95, 15m),
    ["Norwegian Viva"] = new("Norwegian", "Norwegian Viva", "Prima", 2023, "None", 142500, 3215, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.4m,
        "Tidal Wave slide, Aqua Park double drops, Infinity pool", "Sister to Prima; Haven with retractable glass roof courtyard",
        85, 95, 78, 92, 95, 15m),
    ["Norwegian Aqua"] = new("Norwegian", "Norwegian Aqua", "Prima Plus", 2025, "None", 156300, 3571, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.5m,
        "Aqua Slidecoaster, AquaLoop freefall, The Pier pool", "Largest NCL ship; elevated Haven with duplex suites; debuts 2025",
        95, 98, 78, 95, 98, 15m),
    ["Norwegian Aura"] = new("Norwegian", "Norwegian Aura", "Prima Plus", 2027, "None", 169000, 3840, true,
        "Little Explorer's Cove (2-6), Adventure Alley (6-10), Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.5m,
        "Eclipse Racers dueling slides, Aura Free Fall drop slide, The Wave raft slide, The Drop 10-deck dry slide, Kids Aqua Park, 82ft ropes course", "Largest NCL ever; Ocean Heights multi-deck activity complex; Haven 3-BR duplex suites; incredible for families with young kids",
        98, 98, 78, 95, 98, 15m),
    ["Norwegian Luna"] = new("Norwegian", "Norwegian Luna", "Prima Plus", 2026, "None", 156300, 3571, true,
        "Splash Academy (3-12), Entourage (13-17), Guppies (6mo-4yr)", "The Haven", 2.5m,
        "Aqua Slidecoaster, AquaLoop freefall, Kids Aqua Park, splash pad", "Sister to Aqua; Prima Plus class; full Haven with 3-BR duplex suites; Guppies nursery for toddlers; debuts Mar 2026",
        95, 98, 78, 95, 98, 15m),
    ["Norwegian Encore"] = new("Norwegian", "Norwegian Encore", "Breakaway Plus", 2019, "2024", 169116, 3998, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 3.0m,
        "Aqua Park multi-story slides, go-kart racetrack", "Full Haven w/ private restaurant + pool; racetrack; excellent for families",
        88, 88, 78, 92, 95, 15m),
    ["Norwegian Bliss"] = new("Norwegian", "Norwegian Bliss", "Breakaway Plus", 2018, "2021", 168028, 4004, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 3.0m,
        "Aqua Park with Ocean Loops, go-kart racetrack", "Full Haven; laser tag; observation lounge",
        88, 88, 78, 92, 95, 15m),
    ["Norwegian Joy"] = new("Norwegian", "Norwegian Joy", "Breakaway Plus", 2017, "2024", 167725, 3804, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 3.0m,
        "Aqua Park, go-kart racetrack", "Full Haven; originally for Chinese market, refitted for US",
        85, 85, 78, 88, 92, 15m),
    ["Norwegian Escape"] = new("Norwegian", "Norwegian Escape", "Breakaway Plus", 2015, "2022", 164600, 4266, true,
        "Splash Academy (3-12), Entourage (13-17), Guppies Nursery", "The Haven", 3.0m,
        "Aqua Park 5 multi-story slides, rope course", "Full Haven; one of the largest ships; sails from NYC primarily",
        88, 85, 78, 92, 95, 15m),
    ["Norwegian Breakaway"] = new("Norwegian", "Norwegian Breakaway", "Breakaway", 2013, "2025", 145655, 3963, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.5m,
        "Aqua Park 5 slides, rope course, 2 pools", "Full Haven (slightly smaller); sails New Orleans/East Coast",
        85, 82, 78, 88, 88, 15m),
    ["Norwegian Getaway"] = new("Norwegian", "Norwegian Getaway", "Breakaway", 2014, "2019", 145655, 3963, true,
        "Splash Academy (3-12), Entourage (13-17)", "The Haven", 2.5m,
        "Aqua Park slides, rope course, pools", "Full Haven; sails Port Canaveral/Caribbean",
        85, 82, 78, 88, 88, 15m),
    ["Norwegian Epic"] = new("Norwegian", "Norwegian Epic", "Epic", 2010, "2025", 155873, 4100, true,
        "Splash Academy (3-12), Entourage (13-17)", "Haven Suites", 2.5m,
        "Aqua Park with Epic Plunge, 3 pools, kids pool", "Haven suites but NO separate Haven restaurant/pool; unique studio cabins",
        82, 78, 75, 85, 85, 15m),
    ["Norwegian Gem"] = new("Norwegian", "Norwegian Gem", "Jewel", 2007, "2015", 93530, 2394, true,
        "Splash Academy (3-12), Entourage (13-17)", "Haven Suites", 2.0m,
        "Pool deck, kids pool", "Haven courtyard but smaller/older; no private Haven restaurant",
        78, 75, 75, 82, 78, 12m),
    ["Norwegian Jewel"] = new("Norwegian", "Norwegian Jewel", "Jewel", 2005, "2018", 93502, 2376, true,
        "Splash Academy (3-12), Entourage (13-17)", "Haven Suites", 2.0m,
        "Pool deck, kids pool", "Older Jewel class; Haven suites with limited private amenities",
        78, 75, 75, 82, 78, 12m),
    ["Norwegian Jade"] = new("Norwegian", "Norwegian Jade", "Jewel", 2006, "2017", 93558, 2402, true,
        "Splash Academy (3-12), Entourage (13-17)", "Haven Suites", 2.0m,
        "Pool deck, kids pool", "Mostly European itineraries; limited Haven complex",
        78, 75, 75, 82, 78, 12m),
    ["Norwegian Pearl"] = new("Norwegian", "Norwegian Pearl", "Jewel", 2006, "2017", 93530, 2394, true,
        "Splash Academy (3-12), Entourage (13-17)", "Haven Suites", 2.0m,
        "Bowl slide, pool deck, kids pool", "Jewel class; has bowling alley; Haven with limited private areas",
        78, 75, 75, 82, 78, 12m),
    ["Norwegian Dawn"] = new("Norwegian", "Norwegian Dawn", "Dawn", 2002, "2021", 91740, 2340, true,
        "Splash Academy (3-12), Entourage (13-17)", "None", 0m,
        "Pool deck, kids pool", "NO Haven suites; older/smaller ship",
        75, 72, 75, 78, 75, 12m),
    ["Norwegian Star"] = new("Norwegian", "Norwegian Star", "Dawn", 2001, "2018", 91740, 2348, true,
        "Splash Academy (3-12), Entourage (13-17)", "None", 0m,
        "Pool deck, kids pool", "NO Haven; primarily sails Europe",
        75, 72, 75, 78, 75, 12m),
    ["Norwegian Sun"] = new("Norwegian", "Norwegian Sun", "Sun", 2001, "2018", 78309, 1936, true,
        "Splash Academy (3-12), Entourage (13-17)", "None", 0m,
        "Pool deck, kids pool", "NO Haven; smaller ship; port-intensive itineraries",
        72, 72, 72, 75, 72, 10m),
    ["Norwegian Sky"] = new("Norwegian", "Norwegian Sky", "Sun", 1999, "2019", 77104, 2004, true,
        "Splash Academy (3-12), Entourage (13-17)", "None", 0m,
        "Pool deck", "NO Haven; free open bar included; short Bahamas from Miami",
        72, 72, 72, 75, 72, 10m),
    ["Norwegian Spirit"] = new("Norwegian", "Norwegian Spirit", "Unclassed", 1998, "2020", 75338, 2018, false,
        "NO kids program (no Splash Academy)", "None", 0m,
        "Pool deck", "NO kids program AND no Haven — NOT SUITABLE for families",
        65, 68, 72, 75, 72, 10m),
    ["Pride of America"] = new("Norwegian", "Pride of America", "Unclassed", 2005, "2025", 80439, 2186, true,
        "Splash Academy (3-12), Entourage (13-17)", "None", 0m,
        "Pool deck, kids pool", "Hawaii only (US-flagged); NO Haven; inter-island itinerary",
        75, 72, 75, 78, 75, 12m),

    // CELEBRITY                                                      SuiteName    Mult  KidsR ShipR  MainDin PkgDin SuiteDin PkgCost
    ["Celebrity Edge"] = new("Celebrity", "Celebrity Edge", "Edge", 2018, "None", 130818, 2908, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Rooftop Garden, Resort Deck pool, solarium", "First Edge class; outward-facing design with Magic Carpet bar",
        82, 95, 92, 95, 98, 18m),
    ["Celebrity Apex"] = new("Celebrity", "Celebrity Apex", "Edge", 2020, "None", 130818, 2910, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Rooftop Garden, Resort Deck pool, solarium", "Sails Caribbean from Port Canaveral; sister to Edge",
        82, 95, 92, 95, 98, 18m),
    ["Celebrity Beyond"] = new("Celebrity", "Celebrity Beyond", "Edge", 2022, "None", 140600, 3260, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Rooftop Garden, multi-level Resort Deck, solarium", "Larger Edge-class variant; two-story Sunset Bar; sails from Ft Lauderdale",
        82, 98, 95, 98, 98, 18m),
    ["Celebrity Ascent"] = new("Celebrity", "Celebrity Ascent", "Edge", 2023, "None", 140600, 3260, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Rooftop Garden, multi-level Resort Deck, solarium", "Sister to Beyond; sails Caribbean from Ft Lauderdale",
        82, 98, 95, 98, 98, 18m),
    ["Celebrity Xcel"] = new("Celebrity", "Celebrity Xcel", "Edge", 2025, "None", 140600, 3260, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Rooftop Garden, Resort Deck, solarium", "Newest Celebrity ship; debuts Nov 2025 from Ft Lauderdale",
        82, 98, 95, 98, 98, 18m),
    ["Celebrity Eclipse"] = new("Celebrity", "Celebrity Eclipse", "Solstice", 2010, "2019", 121878, 2850, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium, lawn club", "Solstice class; real grass Lawn Club; sails from Ft Lauderdale",
        78, 85, 88, 92, 95, 18m),
    ["Celebrity Silhouette"] = new("Celebrity", "Celebrity Silhouette", "Solstice", 2011, "2020", 122210, 2886, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium, lawn club", "Solstice class; revolutionized with refurbishment; sails from Ft Lauderdale",
        78, 85, 88, 92, 95, 18m),
    ["Celebrity Reflection"] = new("Celebrity", "Celebrity Reflection", "Solstice", 2012, "2020", 125366, 3046, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium, lawn club, The Alcoves", "Largest Solstice class; suite-only sundeck added; sails Ft Lauderdale",
        78, 88, 88, 92, 95, 18m),
    ["Celebrity Summit"] = new("Celebrity", "Celebrity Summit", "Millennium", 2001, "2019", 90940, 2158, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium", "Millennium class; modernized 2019; smaller/more intimate; sails from Ft Lauderdale",
        75, 78, 85, 88, 92, 18m),
    ["Celebrity Constellation"] = new("Celebrity", "Celebrity Constellation", "Millennium", 2002, "2024", 90940, 2170, true,
        "Camp at Sea (3-11), Teen Club (12-17)", "The Retreat", 2.0m,
        "2 pools (1 family, 1 Solarium adults-only), 4 hot tubs", "Millennium class; adult-forward vibe; no slides/water park; Camp at Sea is basic; good for older kids but limited for young boys",
        72, 78, 85, 88, 92, 18m),
    // ── Additional Celebrity ships ──────────────────────────────────
    ["Celebrity Equinox"] = new("Celebrity", "Celebrity Equinox", "Solstice", 2009, "2019", 122000, 2850, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium, lawn club", "Solstice class; Revolution refurb 2019; sails Caribbean",
        78, 85, 88, 92, 95, 18m),
    ["Celebrity Solstice"] = new("Celebrity", "Celebrity Solstice", "Solstice", 2008, "2016", 121878, 2852, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium, lawn club", "First Solstice class; introduced real grass Lawn Club; sails Alaska/Pacific",
        78, 85, 88, 92, 95, 18m),
    ["Celebrity Millennium"] = new("Celebrity", "Celebrity Millennium", "Millennium", 2000, "2019", 90940, 2218, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium", "Millennium class; modernized 2019; sails Alaska/Asia",
        75, 78, 85, 88, 92, 18m),
    ["Celebrity Infinity"] = new("Celebrity", "Celebrity Infinity", "Millennium", 2001, "2024", 90940, 2170, true,
        "Ship Mates (3-5), Cadets (6-9), Captains (10-12), Teens (13-17)", "The Retreat", 2.0m,
        "Pool deck, solarium", "Millennium class; Revolution refurb 2024; sails South America/Panama Canal",
        75, 78, 85, 88, 92, 18m),
    ["Celebrity Flora"] = new("Celebrity", "Celebrity Flora", "Galapagos", 2019, "None", 5739, 100, false,
        "None", "The Retreat", 2.0m,
        "Open-air decks, jacuzzi", "Galapagos expedition mega-yacht; 100 guests; eco-friendly dynamic positioning; all-suite",
        30, 82, 90, 90, 92, 18m),
    ["Celebrity Seeker"] = new("Celebrity", "Celebrity Seeker", "Journeys", 2026, "None", 9300, 224, false,
        "None", "The Retreat", 2.0m,
        "Pool deck, marina", "New Journeys class; small luxury expedition yacht; debuting 2026",
        30, 80, 88, 90, 92, 18m),
    ["Celebrity Compass"] = new("Celebrity", "Celebrity Compass", "Journeys", 2027, "None", 9300, 224, false,
        "None", "The Retreat", 2.0m,
        "Pool deck, marina", "Journeys class; sister to Seeker; debuting 2027",
        30, 80, 88, 90, 92, 18m),
    ["Celebrity Wanderer"] = new("Celebrity", "Celebrity Wanderer", "Journeys", 2027, "None", 9300, 224, false,
        "None", "The Retreat", 2.0m,
        "Pool deck, marina", "Journeys class; debuting 2027",
        30, 80, 88, 90, 92, 18m),
    ["Celebrity Roamer"] = new("Celebrity", "Celebrity Roamer", "Journeys", 2028, "None", 9300, 224, false,
        "None", "The Retreat", 2.0m,
        "Pool deck, marina", "Journeys class; debuting 2028",
        30, 80, 88, 90, 92, 18m),
    ["Celebrity Boundless"] = new("Celebrity", "Celebrity Boundless", "Journeys", 2029, "None", 9300, 224, false,
        "None", "The Retreat", 2.0m,
        "Pool deck, marina", "Journeys class; debuting 2029",
        30, 80, 88, 90, 92, 18m),
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
app.MapGet("/api/stats", async () =>
{
    using var conn = new SqlConnection(connectionString);
    var totalSailings = await conn.ExecuteScalarAsync<int>(
        "SELECT COUNT(*) FROM Cruises WHERE DepartureDate >= CAST(GETDATE() AS DATE)");

    var stats = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
        ;WITH LatestPrices AS (
            SELECT ph.ShipName, ph.BalconyPerDay, ph.SuitePerDay,
                   ROW_NUMBER() OVER (PARTITION BY ph.CruiseLine, ph.ShipName, ph.DepartureDate ORDER BY ph.ScrapedAt DESC) AS rn
            FROM PriceHistory ph
            INNER JOIN Cruises c ON c.CruiseLine = ph.CruiseLine AND c.ShipName = ph.ShipName AND c.DepartureDate = ph.DepartureDate
            WHERE c.DepartureDate >= CAST(GETDATE() AS DATE)
        )
        SELECT
            COUNT(DISTINCT ShipName) AS Ships,
            MIN(CASE WHEN BalconyPerDay > 0 THEN BalconyPerDay END) AS CheapestBalconyPPD,
            MIN(CASE WHEN SuitePerDay > 0 THEN SuitePerDay END) AS CheapestSuitePPD
        FROM LatestPrices
        WHERE rn = 1");

    var latestScrape = await conn.ExecuteScalarAsync<DateTime?>(
        "SELECT MAX(ScrapedAt) FROM PriceHistory");

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

// GET /api/filter-options — Distinct ship names and ports for multi-select filters
app.MapGet("/api/filter-options", async () =>
{
    using var conn = new SqlConnection(connectionString);
    var lines = (await conn.QueryAsync<string>(
        "SELECT DISTINCT CruiseLine FROM Cruises WHERE DepartureDate >= CAST(GETDATE() AS DATE) ORDER BY CruiseLine")).ToList();
    var ships = (await conn.QueryAsync<string>(
        "SELECT DISTINCT ShipName FROM Cruises WHERE DepartureDate >= CAST(GETDATE() AS DATE) ORDER BY ShipName")).ToList();
    var ports = (await conn.QueryAsync<string>(
        "SELECT DISTINCT DeparturePort FROM Cruises WHERE DepartureDate >= CAST(GETDATE() AS DATE) ORDER BY DeparturePort")).ToList();
    return Results.Ok(new { lines, ships, ports });
});

// GET /api/cruises?line=Disney&ship=&port=&sortBy=departureDate&sortDir=asc
app.MapGet("/api/cruises", async (string? line, string? ship, string? port, string? sortBy, string? sortDir, string? mode) =>
{
    using var conn = new SqlConnection(connectionString);
    var sql = @"
        SELECT
            c.CruiseLine, c.ShipName, c.Itinerary, c.ItineraryCode, c.DepartureDate, c.Nights, c.DeparturePort, c.Ports,
            p.InsidePrice, p.InsidePerDay, p.OceanviewPrice, p.OceanviewPerDay,
            p.BalconyPrice, p.BalconyPerDay, p.SuitePrice, p.SuitePerDay, p.ScrapedAt,
            fl.FLResBalconyPrice, fl.FLResBalconyPerDay, fl.FLResSuitePrice, fl.FLResSuitePerDay, fl.FLResScrapedAt
        FROM Cruises c
        OUTER APPLY (
            SELECT TOP 1 ph.InsidePrice, ph.InsidePerDay, ph.OceanviewPrice, ph.OceanviewPerDay,
                   ph.BalconyPrice, ph.BalconyPerDay, ph.SuitePrice, ph.SuitePerDay, ph.ScrapedAt
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
        WHERE c.IsDeparted = 0 AND c.DepartureDate >= CAST(GETDATE() AS DATE)";

    // Suite mode: exclude cruises with no suite pricing at all
    if (string.Equals(mode, "suite", StringComparison.OrdinalIgnoreCase))
    {
        sql += " AND ISNULL(p.SuitePerDay, 0) > 0";
    }

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
               FLResBalconyPrice, FLResBalconyPerDay, FLResSuitePrice, FLResSuitePerDay
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
            SuitePrice = (decimal?)(r.SuitePrice),
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

// Fallback: serve index.html for SPA-like routing
app.MapFallbackToFile("index.html");

// ── Calendar Events (JSON persistence) ──────────────────────────────────
// Store outside publish folder so deploys don't wipe user data
var calendarJsonPath = Path.Combine(AppContext.BaseDirectory, "..", "calendar-events.json");
var calendarEvents = new List<CalendarEvent>();
if (File.Exists(calendarJsonPath))
{
    try
    {
        var json = File.ReadAllText(calendarJsonPath);
        calendarEvents = System.Text.Json.JsonSerializer.Deserialize<List<CalendarEvent>>(json,
            new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
    }
    catch { /* start fresh if corrupt */ }
}

void SaveCalendarEvents()
{
    var json = System.Text.Json.JsonSerializer.Serialize(calendarEvents,
        new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
    File.WriteAllText(calendarJsonPath, json);
}

app.MapGet("/api/calendar-events", () => Results.Ok(calendarEvents));

app.MapPost("/api/calendar-events", (CalendarEvent evt) =>
{
    var newEvt = evt with { Id = Guid.NewGuid().ToString("N")[..8] };
    calendarEvents.Add(newEvt);
    SaveCalendarEvents();
    return Results.Ok(newEvt);
});

app.MapDelete("/api/calendar-events/{id}", (string id) =>
{
    var removed = calendarEvents.RemoveAll(e => e.Id == id);
    if (removed == 0) return Results.NotFound();
    SaveCalendarEvents();
    return Results.Ok();
});

app.MapPut("/api/calendar-events/{id}", (string id, CalendarEvent evt) =>
{
    var idx = calendarEvents.FindIndex(e => e.Id == id);
    if (idx < 0) return Results.NotFound();
    calendarEvents[idx] = evt with { Id = id };
    SaveCalendarEvents();
    return Results.Ok(calendarEvents[idx]);
});

app.Run();

// ── Records ─────────────────────────────────────────────────────────────
record ShipInfo(
    string CruiseLine, string ShipName, string ShipClass,
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
