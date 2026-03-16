// ═══════════════════════════════════════════════════════════════════════
// DashboardEndpoints.cs — Main dashboard API routes
// 
// Routes:
//   GET  /api/stats                    → Dashboard summary (sailing count, cheapest PPD, scraper health)
//   GET  /api/filter-options           → Distinct lines/ships/ports for dropdown filters
//   GET  /api/cruises                  → Paginated sailing list with latest prices + ship metadata
//   GET  /api/price-history/{...}      → Historical price snapshots for a specific sailing
//   GET  /api/ships                    → Full fleet reference data (ShipInfo records)
//   GET  /api/deals                    → Cruises below hardcoded alert thresholds
//   GET  /api/hot-deals               → Multi-signal heat-scored deals (price drop, peer outlier, quality-price gap). Params: `appMode`, `mode` (suite uses SuitePerDay + SuiteDiningScore)
//   GET  /api/analytics               → Chart data (by-line, by-ship, departure curve, monthly heatmap). Params: `appMode`, `priceType`, `line`
//   GET  /api/market-brief            → 24h price change intelligence (alerts, market pulse, per-line breakdown). Params: `appMode`, `priceType`, `line`
//
// Dependencies: connectionString, ships dictionary, allRestaurants cache
// Shared records: ShipInfo, RestaurantData (in Data/ShipReferenceData.cs)
// ═══════════════════════════════════════════════════════════════════════
using Dapper;
using Microsoft.Data.SqlClient;
using CruiseDashboard.Data;

namespace CruiseDashboard.Endpoints;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this WebApplication app,
        string connStr,
        Dictionary<string, ShipInfo> ships,
        Dictionary<string, List<RestaurantData>> allRestaurants)
    {
        // GET /api/stats â€” Dashboard summary numbers
        app.MapGet("/api/stats", async (string? appMode) =>
        {
            using var conn = new SqlConnection(connStr);
            var modeLines = ShipReferenceData.LinesForMode(ships, appMode);
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
        
        // GET /api/filter-options â€” Distinct ship names and ports for multi-select filters
        app.MapGet("/api/filter-options", async (string? appMode) =>
        {
            using var conn = new SqlConnection(connStr);
            var modeLines = ShipReferenceData.LinesForMode(ships, appMode);
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
        
        app.MapGet("/api/cruises", async (string? line, string? ship, string? port, string? sortBy, string? sortDir, string? mode, string? appMode) =>
        {
            using var conn = new SqlConnection(connStr);
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
                    p.VerifiedSuitePrice, p.VerifiedSuitePerDay,
                    fl.FLResBalconyPrice, fl.FLResBalconyPerDay, fl.FLResSuitePrice, fl.FLResSuitePerDay, fl.FLResScrapedAt
                FROM Cruises c
                OUTER APPLY (
                    SELECT TOP 1 ph.InsidePrice, ph.InsidePerDay, ph.OceanviewPrice, ph.OceanviewPerDay,
                           ph.BalconyPrice, ph.BalconyPerDay, ph.SuitePrice, ph.SuitePerDay, ph.ScrapedAt,
                           ph.FamilyInsidePrice, ph.FamilyInsidePerDay, ph.FamilyOceanviewPrice, ph.FamilyOceanviewPerDay,
                           ph.FamilyBalconyPrice, ph.FamilyBalconyPerDay, ph.FamilySuitePrice, ph.FamilySuitePerDay,
                           ph.VerifiedSuitePrice, ph.VerifiedSuitePerDay
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
                sql += " AND (ISNULL(p.SuitePerDay, 0) > 0 OR ISNULL(p.VerifiedSuitePerDay, 0) > 0)";
            }
        
            // App mode: filter by cruise line category
            var modeLines = ShipReferenceData.LinesForMode(ships, appMode);
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
                var si = ShipReferenceData.LookupShip(ships, (string)r.ShipName);
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
                    VerifiedSuitePrice = (decimal?)(r.VerifiedSuitePrice),
                    VerifiedSuitePerDay = (decimal?)(r.VerifiedSuitePerDay),
                    ScrapedAt = r.ScrapedAt != null ? ((DateTime)r.ScrapedAt).ToString("yyyy-MM-dd HH:mm") : null
                };
            });
        
            return Results.Ok(result);
        });

        // GET /api/price-history/{cruiseLine}/{shipName}/{departureDate}
        app.MapGet("/api/price-history/{cruiseLine}/{shipName}/{departureDate}", async (string cruiseLine, string shipName, string departureDate) =>
        {
            using var conn = new SqlConnection(connStr);
            var rows = await conn.QueryAsync<dynamic>(@"
                WITH DailyPrices AS (
                    SELECT ScrapedAt, BalconyPrice, BalconyPerDay, SuitePrice, SuitePerDay,
                           InsidePrice, InsidePerDay, OceanviewPrice, OceanviewPerDay,
                           FLResBalconyPrice, FLResBalconyPerDay, FLResSuitePrice, FLResSuitePerDay,
                           FamilyInsidePrice, FamilyInsidePerDay, FamilyOceanviewPrice, FamilyOceanviewPerDay,
                           FamilyBalconyPrice, FamilyBalconyPerDay, FamilySuitePrice, FamilySuitePerDay,
                           ROW_NUMBER() OVER (PARTITION BY CAST(ScrapedAt AS DATE) ORDER BY ScrapedAt DESC) AS rn
                    FROM PriceHistory
                    WHERE CruiseLine = @cruiseLine AND ShipName = @shipName AND DepartureDate = @departureDate
                )
                SELECT ScrapedAt, BalconyPrice, BalconyPerDay, SuitePrice, SuitePerDay,
                       InsidePrice, InsidePerDay, OceanviewPrice, OceanviewPerDay,
                       FLResBalconyPrice, FLResBalconyPerDay, FLResSuitePrice, FLResSuitePerDay,
                       FamilyInsidePrice, FamilyInsidePerDay, FamilyOceanviewPrice, FamilyOceanviewPerDay,
                       FamilyBalconyPrice, FamilyBalconyPerDay, FamilySuitePrice, FamilySuitePerDay
                FROM DailyPrices WHERE rn = 1
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
        
        // GET /api/ships â€” full fleet reference
        app.MapGet("/api/ships", () =>
        {
            return Results.Ok(ships.Values.OrderBy(s => s.CruiseLine).ThenBy(s => s.YearBuilt));
        });
        
        // GET /api/deals â€” cruises at or below alert thresholds
        app.MapGet("/api/deals", async () =>
        {
            var thresholds = new Dictionary<string, (decimal Balcony, decimal Suite)>
            {
                ["Disney"] = (300m, 500m),
                ["Norwegian"] = (150m, 250m)
            };
        
            using var conn = new SqlConnection(connStr);
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
                var si = ShipReferenceData.LookupShip(ships, (string)r.ShipName);
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
        // mode=suite uses SuitePerDay + SuiteDiningScore; default uses BalconyPerDay + MainDiningScore
        app.MapGet("/api/hot-deals", async (string? appMode, string? mode) =>
        {
            using var conn = new SqlConnection(connStr);
            var modeLines = ShipReferenceData.LinesForMode(ships, appMode);
            var lineFilter = string.Join(",", modeLines.Select(l => $"'{l}'"));
            var isSuiteMode = string.Equals(mode, "suite", StringComparison.OrdinalIgnoreCase);
            var priceCol = isSuiteMode ? "SuitePerDay" : "BalconyPerDay";
            var priceTotalCol = isSuiteMode ? "SuitePrice" : "BalconyPrice";
            var priceLabel = isSuiteMode ? "suite" : "balcony";
        
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
                    SELECT MAX(ph2.{priceCol}) AS PeakPpd, MIN(ph2.{priceCol}) AS LowestPpd, COUNT(*) AS Snapshots
                    FROM PriceHistory ph2
                    WHERE ph2.CruiseLine = c.CruiseLine AND ph2.ShipName = c.ShipName AND ph2.DepartureDate = c.DepartureDate
                      AND ph2.{priceCol} > 0
                      AND ph2.ScrapedAt >= '2026-02-28'
                ) hist
                WHERE c.IsDeparted = 0 AND c.DepartureDate >= CAST(GETDATE() AS DATE)
                  AND c.CruiseLine IN ({lineFilter})
                  AND p.{priceCol} > 0
                  AND p.ScrapedAt > DATEADD(hour, -36, (SELECT MaxScrapedAt FROM LatestScrapes ls WHERE ls.CruiseLine = c.CruiseLine))
                  AND (c.Itinerary IS NULL OR c.Itinerary NOT LIKE '%transatlantic%')
            ");
        
            var allRows = rows.ToList();
            if (allRows.Count == 0) return Results.Ok(Array.Empty<object>());
        
            // Helper to extract the mode-relevant PPD from a row
            decimal GetPpd(dynamic r) => isSuiteMode ? (decimal)(r.SuitePerDay ?? 0m) : (decimal)r.BalconyPerDay;
        
            // Compute per-line, per-nights-bucket percentiles (P10, P25)
            string NightsBucket(int n) => n <= 4 ? "3-4" : n <= 6 ? "5-6" : n <= 8 ? "7-8" : n <= 11 ? "9-11" : "12+";
        
            var peerGroups = allRows
                .GroupBy(r => $"{(string)r.CruiseLine}|{NightsBucket((int)(r.Nights ?? 7))}")
                .ToDictionary(
                    g => g.Key,
                    g =>
                    {
                        var prices = g.Select(r => GetPpd(r)).Where(p => p > 0).OrderBy(p => p).ToList();
                        var cnt = prices.Count;
                        if (cnt == 0) return new { P10 = 0m, P25 = 0m, Median = 0m, Count = 0 };
                        return new
                        {
                            P10 = prices[(int)(cnt * 0.10)],
                            P25 = prices[(int)(cnt * 0.25)],
                            Median = prices[(int)(cnt * 0.50)],
                            Count = cnt
                        };
                    });
        
            // Compute per-line quality percentiles (ship + dining quality)
            // Use SuiteDiningScore for suite mode, MainDiningScore otherwise
            var lineQualityThresholds = allRows
                .GroupBy(r => (string)r.CruiseLine)
                .ToDictionary(
                    g => g.Key,
                    g =>
                    {
                        var quals = g.Select(r =>
                        {
                            var si = ShipReferenceData.LookupShip(ships, (string)r.ShipName);
                            var diningScore = isSuiteMode ? (si?.SuiteDiningScore ?? 50) : (si?.MainDiningScore ?? 50);
                            return (si?.ShipScore ?? 50) + diningScore;
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
                        var prices = g.Select(r => GetPpd(r)).Where(p => p > 0).OrderBy(p => p).ToList();
                        if (prices.Count == 0) return 0m;
                        return prices[(int)(prices.Count * 0.30)];
                    });
        
            // Score each cruise
            var scored = allRows.Select(r =>
            {
                var line = (string)r.CruiseLine;
                var shipName = (string)r.ShipName;
                var ppd = GetPpd(r);
                var nights = (int)(r.Nights ?? 7);
                var si = ShipReferenceData.LookupShip(ships, shipName);
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
                        reasons.Add($"📉 {(int)dropPct}% {priceLabel} price drop from peak (${(int)peakPpd}/ppd → ${(int)ppd})");
                    }
                    else if (dropPct >= 15)
                    {
                        heatScore += 1;
                        reasons.Add($"📉 {(int)dropPct}% {priceLabel} price drop from peak");
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
                        reasons.Add($"📊 Bottom 10% {priceLabel} for {nights}-night {line} (${(int)ppd} vs median ${(int)peer.Median})");
                    }
                    else if (ppd <= peer.P25)
                    {
                        heatScore += 1;
                        reasons.Add($"📊 Bottom 25% {priceLabel} for {nights}-night {line}");
                    }
                }
        
                // Signal 3: Quality-Price Gap
                if (si != null)
                {
                    var diningScore = isSuiteMode ? si.SuiteDiningScore : si.MainDiningScore;
                    var qualScore = si.ShipScore + diningScore;
                    var topQuality = lineQualityThresholds.TryGetValue(line, out var lq) && qualScore >= lq.Top30;
                    var lowPrice = linePriceP30.TryGetValue(line, out var lp) && ppd <= lp;
        
                    if (topQuality && lowPrice)
                    {
                        var shipQ = si.ShipScore;
                        var dinQ = diningScore;
                        if (ppd <= (linePriceP30.GetValueOrDefault(line, 999) * 0.70m))
                        {
                            heatScore += 2;
                            reasons.Add($"🏆 Top-tier ship (ship:{shipQ} dining:{dinQ}) at rock-bottom {priceLabel} price");
                        }
                        else
                        {
                            heatScore += 1;
                            reasons.Add($"🏆 Top-tier ship (ship:{shipQ} dining:{dinQ}) at below-average {priceLabel} price");
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
                    BalconyPerDay = (decimal)(r.BalconyPerDay ?? 0m),
                    SuitePrice = (decimal?)(r.SuitePrice),
                    SuitePerDay = (decimal?)(r.SuitePerDay),
                    KidsScore = si?.KidsScore ?? 0,
                    ShipScore = si?.ShipScore ?? 0,
                    MainDiningScore = si?.MainDiningScore ?? 0,
                    PackageDiningScore = si?.PackageDiningScore ?? 0,
                    SuiteDiningScore = si?.SuiteDiningScore ?? 0,
                    DiningPackageCostPerDay = si?.DiningPackageCostPerDay ?? 0m,
                    PeakPpd = peakPpd,
                    Snapshots = snapshots,
                    ScrapedAt = r.ScrapedAt != null ? ((DateTime)r.ScrapedAt).ToString("yyyy-MM-dd HH:mm") : null
                };
            })
            .Where(x => x.HeatScore >= 3)
            .OrderByDescending(x => x.HeatScore)
            .ThenBy(x => isSuiteMode ? (x.SuitePerDay ?? 99999m) : x.BalconyPerDay)
            .ToList();
        
            return Results.Ok(scored);
        });
        
        // GET /api/analytics â€” pricing statistics for charts
        app.MapGet("/api/analytics", async (string? appMode, string? priceType, string? line) =>
        {
            using var conn = new SqlConnection(connStr);
            var modeLines = ShipReferenceData.LinesForMode(ships, appMode);
            var lineFilter = string.Join(",", modeLines.Select(l => $"'{l}'"));
            var minDate = "2026-02-28"; // Exclude pre-2/28 cruise.com data
            var priceCol = priceType == "suite" ? "SuitePerDay" : "BalconyPerDay";
            var singleLineFilter = !string.IsNullOrEmpty(line) ? $" AND CruiseLine = '{line.Replace("'", "''")}' " : "";
        
            // 1. Per-line averages
            var byLine = await conn.QueryAsync<dynamic>($@"
                SELECT CruiseLine, AVG({priceCol}) AS AvgPpd, MIN({priceCol}) AS MinPpd,
                       COUNT(DISTINCT CONCAT(ShipName,'|',DepartureDate)) AS Sailings
                FROM PriceHistory
                WHERE {priceCol} > 0 AND ScrapedAt >= '{minDate}'
                  AND CruiseLine IN ({lineFilter}) {singleLineFilter}
                  AND ScrapedAt = (SELECT MAX(p2.ScrapedAt) FROM PriceHistory p2
                                  WHERE p2.CruiseLine = PriceHistory.CruiseLine AND p2.ShipName = PriceHistory.ShipName
                                  AND p2.DepartureDate = PriceHistory.DepartureDate)
                  AND DepartureDate >= CAST(GETDATE() AS DATE)
                GROUP BY CruiseLine ORDER BY AvgPpd");
        
            // 2. Per-ship averages (latest price per sailing, grouped by ship)
            var byShip = await conn.QueryAsync<dynamic>($@"
                WITH LatestPrice AS (
                    SELECT CruiseLine, ShipName, DepartureDate, {priceCol} AS PricePerDay,
                           ROW_NUMBER() OVER (PARTITION BY CruiseLine, ShipName, DepartureDate ORDER BY ScrapedAt DESC) AS rn
                    FROM PriceHistory
                    WHERE {priceCol} > 0 AND ScrapedAt >= '{minDate}'
                      AND CruiseLine IN ({lineFilter}) {singleLineFilter}
                      AND DepartureDate >= CAST(GETDATE() AS DATE)
                )
                SELECT CruiseLine, ShipName, CAST(AVG(PricePerDay) AS int) AS AvgPpd,
                       CAST(MIN(PricePerDay) AS int) AS MinPpd, COUNT(*) AS Sailings
                FROM LatestPrice WHERE rn = 1
                GROUP BY CruiseLine, ShipName
                ORDER BY CruiseLine, AvgPpd");
        
            // 3. Days-to-departure pricing curve
            var departureCurve = await conn.QueryAsync<dynamic>($@"
                SELECT
                    CASE WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 14 THEN 7
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 30 THEN 22
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 60 THEN 45
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 90 THEN 75
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 120 THEN 105
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 180 THEN 150
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 270 THEN 225
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 365 THEN 320
                         ELSE 450 END AS DaysOut,
                    ph.CruiseLine,
                    CAST(AVG(ph.{priceCol}) AS int) AS AvgPpd,
                    COUNT(*) AS Snapshots
                FROM PriceHistory ph
                INNER JOIN Cruises c ON c.CruiseLine = ph.CruiseLine AND c.ShipName = ph.ShipName AND c.DepartureDate = ph.DepartureDate
                WHERE ph.{priceCol} > 0 AND ph.ScrapedAt >= '{minDate}'
                  AND ph.CruiseLine IN ({lineFilter}) {singleLineFilter}
                  AND ph.DepartureDate >= '2026-01-01'
                  AND (c.Itinerary IS NULL OR c.Itinerary NOT LIKE '%transatlantic%')
                GROUP BY
                    CASE WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 14 THEN 7
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 30 THEN 22
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 60 THEN 45
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 90 THEN 75
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 120 THEN 105
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 180 THEN 150
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 270 THEN 225
                         WHEN DATEDIFF(day, ph.ScrapedAt, ph.DepartureDate) <= 365 THEN 320
                         ELSE 450 END,
                    ph.CruiseLine
                ORDER BY ph.CruiseLine, DaysOut");
        
            // 4. Monthly price heatmap (cruise departure month vs line)
            var monthly = await conn.QueryAsync<dynamic>($@"
                WITH LatestPrice AS (
                    SELECT ph.CruiseLine, ph.DepartureDate, ph.{priceCol} AS PricePerDay,
                           ROW_NUMBER() OVER (PARTITION BY ph.CruiseLine, ph.ShipName, ph.DepartureDate ORDER BY ph.ScrapedAt DESC) AS rn
                    FROM PriceHistory ph
                    INNER JOIN Cruises c ON c.CruiseLine = ph.CruiseLine AND c.ShipName = ph.ShipName AND c.DepartureDate = ph.DepartureDate
                    WHERE ph.{priceCol} > 0 AND ph.ScrapedAt >= '{minDate}'
                      AND ph.CruiseLine IN ({lineFilter}) {singleLineFilter}
                      AND ph.DepartureDate >= CAST(GETDATE() AS DATE)
                      AND (c.Itinerary IS NULL OR c.Itinerary NOT LIKE '%transatlantic%')
                )
                SELECT CruiseLine,
                       YEAR(DepartureDate) AS Yr, MONTH(DepartureDate) AS Mo,
                       CAST(AVG(PricePerDay) AS int) AS AvgPpd, COUNT(*) AS Sailings
                FROM LatestPrice WHERE rn = 1
                GROUP BY CruiseLine, YEAR(DepartureDate), MONTH(DepartureDate)
                ORDER BY Yr, Mo, CruiseLine");
        
            // 5. Near-term pricing trend: avg PPD for sailings departing within 2 months of each scrape date
            //    The 2-month window is relative to each scrape date (not today)
            var nearTermTrend = await conn.QueryAsync<dynamic>($@"
                WITH DailyPrices AS (
                    SELECT ph.CruiseLine, ph.ShipName, ph.DepartureDate, ph.{priceCol} AS Ppd,
                           CAST(ph.ScrapedAt AS DATE) AS ScrapeDate,
                           ROW_NUMBER() OVER (PARTITION BY ph.CruiseLine, ph.ShipName, ph.DepartureDate, CAST(ph.ScrapedAt AS DATE) ORDER BY ph.ScrapedAt DESC) AS rn
                    FROM PriceHistory ph
                    INNER JOIN Cruises c ON c.CruiseLine = ph.CruiseLine AND c.ShipName = ph.ShipName AND c.DepartureDate = ph.DepartureDate
                    WHERE ph.{priceCol} > 0 AND ph.ScrapedAt >= '{minDate}'
                      AND ph.CruiseLine IN ({lineFilter}) {singleLineFilter}
                      AND (c.Itinerary IS NULL OR c.Itinerary NOT LIKE '%transatlantic%')
                )
                SELECT CruiseLine, ScrapeDate,
                       CAST(AVG(Ppd) AS int) AS AvgPpd, COUNT(*) AS Sailings
                FROM DailyPrices
                WHERE rn = 1
                  AND DepartureDate >= ScrapeDate
                  AND DepartureDate <= DATEADD(month, 2, ScrapeDate)
                GROUP BY CruiseLine, ScrapeDate
                HAVING COUNT(*) >= 3
                ORDER BY ScrapeDate, CruiseLine");

            // Enrich per-ship with quality scores
            var shipData = byShip.Select(s =>
            {
                var si = ShipReferenceData.LookupShip(ships, (string)s.ShipName);
                return new
                {
                    CruiseLine = (string)s.CruiseLine,
                    ShipName = (string)s.ShipName,
                    AvgPpd = (int)s.AvgPpd,
                    MinPpd = (int)s.MinPpd,
                    Sailings = (int)s.Sailings,
                    ShipScore = si?.ShipScore ?? 0,
                    DiningScore = si?.MainDiningScore ?? 0,
                    KidsScore = si?.KidsScore ?? 0,
                    ShipClass = si?.ShipClass ?? "Unknown"
                };
            });
        
            return Results.Ok(new
            {
                byLine = byLine.Select(r => new { CruiseLine = (string)r.CruiseLine, AvgPpd = (int)Math.Round((decimal)r.AvgPpd), MinPpd = (int)Math.Round((decimal)r.MinPpd), Sailings = (int)r.Sailings }),
                byShip = shipData,
                departureCurve = departureCurve.Select(r => new { DaysOut = (int)r.DaysOut, CruiseLine = (string)r.CruiseLine, AvgPpd = (int)r.AvgPpd, Snapshots = (int)r.Snapshots }),
                monthly = monthly.Select(r => new { CruiseLine = (string)r.CruiseLine, Year = (int)r.Yr, Month = (int)r.Mo, AvgPpd = (int)r.AvgPpd, Sailings = (int)r.Sailings }),
                nearTermTrend = nearTermTrend.Select(r => new { CruiseLine = (string)r.CruiseLine, ScrapeDate = ((DateTime)r.ScrapeDate).ToString("yyyy-MM-dd"), AvgPpd = (int)r.AvgPpd, Sailings = (int)r.Sailings })
            });
        });
        
        // GET /api/market-brief — 24h price change intelligence
        app.MapGet("/api/market-brief", async (string? appMode, string? priceType, string? line) =>
        {
            using var conn = new SqlConnection(connStr);
            var modeLines = ShipReferenceData.LinesForMode(ships, appMode);
            var lineFilter = string.Join(",", modeLines.Select(l => $"'{l}'"));
            var priceCol = priceType == "suite" ? "SuitePerDay" : "BalconyPerDay";
            var singleLineFilter = !string.IsNullOrEmpty(line) ? $" AND ph.CruiseLine = '{line.Replace("'", "''")}' " : "";
            // Find sailings where the current price is at or near its historical low
            // This surfaces genuine buying opportunities, not transient oscillations
            var changes = await conn.QueryAsync<dynamic>($@"
                WITH LatestScrapes AS (
                    SELECT CruiseLine, MAX(ScrapedAt) as MaxScrapedAt
                    FROM PriceHistory
                    GROUP BY CruiseLine
                ),
                CurrentPrices AS (
                    SELECT ph.CruiseLine, ph.ShipName, ph.DepartureDate, ph.{priceCol} AS Ppd, ph.ScrapedAt,
                           ROW_NUMBER() OVER (PARTITION BY ph.CruiseLine, ph.ShipName, ph.DepartureDate ORDER BY ph.ScrapedAt DESC) AS rn
                    FROM PriceHistory ph
                    INNER JOIN Cruises c ON c.CruiseLine = ph.CruiseLine AND c.ShipName = ph.ShipName AND c.DepartureDate = ph.DepartureDate
                    WHERE ph.{priceCol} > 0 AND ph.ScrapedAt >= '2026-02-28'
                      AND ph.CruiseLine IN ({lineFilter}) {singleLineFilter}
                      AND ph.DepartureDate >= CAST(GETDATE() AS DATE)
                      AND c.IsDeparted = 0
                      AND ph.ScrapedAt > DATEADD(hour, -36, (SELECT MaxScrapedAt FROM LatestScrapes ls WHERE ls.CruiseLine = ph.CruiseLine))
                ),
                History AS (
                    SELECT CruiseLine, ShipName, DepartureDate,
                           MAX({priceCol}) AS PeakPpd, MIN({priceCol}) AS FloorPpd, COUNT(*) AS Snapshots
                    FROM PriceHistory
                    WHERE {priceCol} > 0 AND ScrapedAt >= '2026-02-28'
                      AND CruiseLine IN ({lineFilter}) {singleLineFilter}
                      AND DepartureDate >= CAST(GETDATE() AS DATE)
                    GROUP BY CruiseLine, ShipName, DepartureDate
                )
                SELECT cur.CruiseLine, cur.ShipName, cur.DepartureDate,
                       c.Nights, c.DeparturePort,
                       cur.Ppd AS CurrentPpd, h.PeakPpd, h.FloorPpd, h.Snapshots, cur.ScrapedAt AS LatestScrape,
                       CAST(((cur.Ppd - h.PeakPpd) / h.PeakPpd) * 100 AS decimal(8,1)) AS DropFromPeakPct
                FROM CurrentPrices cur
                INNER JOIN History h ON h.CruiseLine = cur.CruiseLine AND h.ShipName = cur.ShipName AND h.DepartureDate = cur.DepartureDate
                INNER JOIN Cruises c ON c.CruiseLine = cur.CruiseLine AND c.ShipName = cur.ShipName AND c.DepartureDate = cur.DepartureDate
                WHERE cur.rn = 1
                  AND h.Snapshots >= 5
                  AND cur.Ppd <= h.FloorPpd * 1.05
                  AND (h.PeakPpd - cur.Ppd) >= 30
                  AND CAST(((cur.Ppd - h.PeakPpd) / h.PeakPpd) * 100 AS decimal(8,1)) <= -20
                ORDER BY CAST(((cur.Ppd - h.PeakPpd) / h.PeakPpd) * 100 AS decimal(8,1)) ASC");

            var changeList = changes.ToList();

            // Timestamps
            var latestScrape = changeList.Any() ? ((DateTime)changeList[0].LatestScrape).ToString("yyyy-MM-dd HH:mm") : null;

            // 1. Alerts: sailings at or near their all-time low, significantly below their peak
            var alerts = changeList
                .Select(c => new
                {
                    CruiseLine = (string)c.CruiseLine,
                    ShipName = (string)c.ShipName,
                    DepartureDate = ((DateTime)c.DepartureDate).ToString("yyyy-MM-dd"),
                    Nights = (int)(c.Nights ?? 0),
                    DeparturePort = (string)(c.DeparturePort ?? ""),
                    PreviousPpd = (int)Math.Round((decimal)c.PeakPpd),
                    CurrentPpd = (int)Math.Round((decimal)c.CurrentPpd),
                    ChangePct = (decimal)c.DropFromPeakPct,
                    Direction = "drop",
                    LatestScrape = ((DateTime)c.LatestScrape).ToString("yyyy-MM-dd HH:mm"),
                    PrevScrape = (string?)null
                })
                .Take(20)
                .ToList();

            // 2. Market summary (day-over-day: today's price vs yesterday's, per-day grouping + LAG)
            var allWithPrev = await conn.QueryAsync<dynamic>($@"
                WITH DailyPrices AS (
                    SELECT ph.CruiseLine, ph.ShipName, ph.DepartureDate,
                           CAST(ph.ScrapedAt AS DATE) AS ScrapeDay,
                           ph.{priceCol} AS Ppd,
                           ROW_NUMBER() OVER (PARTITION BY ph.CruiseLine, ph.ShipName, ph.DepartureDate, CAST(ph.ScrapedAt AS DATE) ORDER BY ph.ScrapedAt DESC) AS rn
                    FROM PriceHistory ph
                    INNER JOIN Cruises c ON c.CruiseLine = ph.CruiseLine AND c.ShipName = ph.ShipName AND c.DepartureDate = ph.DepartureDate
                    WHERE ph.{priceCol} > 0 AND ph.ScrapedAt >= '2026-02-28'
                      AND ph.CruiseLine IN ({lineFilter}) {singleLineFilter}
                      AND ph.DepartureDate >= CAST(GETDATE() AS DATE) AND c.IsDeparted = 0
                ),
                LatestPerDay AS (
                    SELECT CruiseLine, ShipName, DepartureDate, ScrapeDay, Ppd,
                           LAG(Ppd) OVER (PARTITION BY CruiseLine, ShipName, DepartureDate ORDER BY ScrapeDay) AS PrevPpd
                    FROM DailyPrices WHERE rn = 1
                )
                SELECT CruiseLine, Ppd AS CurrentPpd, PrevPpd AS PreviousPpd
                FROM LatestPerDay
                WHERE PrevPpd IS NOT NULL
                  AND ScrapeDay = (SELECT MAX(ScrapeDay) FROM LatestPerDay WHERE PrevPpd IS NOT NULL)");

            var allRows = allWithPrev.ToList();
            var totalSailings = allRows.Count;
            var dropsCount = allRows.Count(r => (decimal)r.CurrentPpd < (decimal)r.PreviousPpd);
            var risesCount = allRows.Count(r => (decimal)r.CurrentPpd > (decimal)r.PreviousPpd);
            var unchangedCount = allRows.Count(r => (decimal)r.CurrentPpd == (decimal)r.PreviousPpd);
            var avgPpdNow = totalSailings > 0 ? (int)Math.Round(allRows.Average(r => (decimal)r.CurrentPpd)) : 0;
            var avgPpdPrev = totalSailings > 0 ? (int)Math.Round(allRows.Average(r => (decimal)r.PreviousPpd)) : 0;
            var avgChangePct = avgPpdPrev > 0 ? Math.Round(((decimal)avgPpdNow - avgPpdPrev) / avgPpdPrev * 100, 1) : 0m;

            // Biggest movers (alerts are drop-only now — near historic low)
            var biggestDrop = alerts.Any()
                ? alerts.OrderBy(a => a.ChangePct).First()
                : null;
            object? biggestRise = null;

            // 3. By-line breakdown
            var byLineGroups = allRows.GroupBy(r => (string)r.CruiseLine).Select(g =>
            {
                var lineAvgNow = (int)Math.Round(g.Average(r => (decimal)r.CurrentPpd));
                var lineAvgPrev = (int)Math.Round(g.Average(r => (decimal)r.PreviousPpd));
                var lineChangePct = lineAvgPrev > 0 ? Math.Round(((decimal)lineAvgNow - lineAvgPrev) / lineAvgPrev * 100, 1) : 0m;
                return new
                {
                    CruiseLine = g.Key,
                    Sailings = g.Count(),
                    AvgPpdNow = lineAvgNow,
                    AvgPpdPrev = lineAvgPrev,
                    AvgChangePct = lineChangePct,
                    DropsCount = g.Count(r => (decimal)r.CurrentPpd < (decimal)r.PreviousPpd),
                    RisesCount = g.Count(r => (decimal)r.CurrentPpd > (decimal)r.PreviousPpd),
                    UnchangedCount = g.Count(r => (decimal)r.CurrentPpd == (decimal)r.PreviousPpd)
                };
            }).OrderBy(l => l.AvgChangePct).ToList();

            return Results.Ok(new
            {
                asOf = latestScrape,
                comparedTo = (string?)null,
                alerts,
                marketSummary = new
                {
                    totalSailings,
                    avgPpdNow,
                    avgPpdPrev,
                    avgChangePct,
                    dropsCount,
                    risesCount,
                    unchangedCount,
                    biggestDrop = biggestDrop != null ? new { biggestDrop.ShipName, biggestDrop.CruiseLine, biggestDrop.ChangePct } : null,
                    biggestRise = (object?)null
                },
                byLine = byLineGroups
            });
        });

        // GET /api/market-sentiment — daily pricing momentum index (-100 to +100)
        app.MapGet("/api/market-sentiment", async (string? appMode, string? priceType) =>
        {
            using var conn = new SqlConnection(connStr);
            var modeLines = ShipReferenceData.LinesForMode(ships, appMode);
            var lineFilter = string.Join(",", modeLines.Select(l => $"'{l}'"));
            var priceCol = priceType == "suite" ? "SuitePerDay" : "BalconyPerDay";
            var minDate = "2026-02-28";

            // For each scrape day × sailing, get day's price vs previous day's price using LAG()
            var rows = await conn.QueryAsync<dynamic>($@"
                WITH DailyPrices AS (
                    SELECT ph.CruiseLine, ph.ShipName, ph.DepartureDate,
                           CAST(ph.ScrapedAt AS DATE) AS ScrapeDay,
                           ph.{priceCol} AS Ppd,
                           ROW_NUMBER() OVER (PARTITION BY ph.CruiseLine, ph.ShipName, ph.DepartureDate, CAST(ph.ScrapedAt AS DATE) ORDER BY ph.ScrapedAt DESC) AS rn
                    FROM PriceHistory ph
                    INNER JOIN Cruises c ON c.CruiseLine = ph.CruiseLine AND c.ShipName = ph.ShipName AND c.DepartureDate = ph.DepartureDate
                    WHERE ph.{priceCol} > 0 AND ph.ScrapedAt >= '{minDate}'
                      AND ph.CruiseLine IN ({lineFilter})
                      AND ph.DepartureDate >= CAST(GETDATE() AS DATE) AND c.IsDeparted = 0
                ),
                LatestPerDay AS (
                    SELECT CruiseLine, ShipName, DepartureDate, ScrapeDay, Ppd,
                           LAG(Ppd) OVER (PARTITION BY CruiseLine, ShipName, DepartureDate ORDER BY ScrapeDay) AS PrevPpd
                    FROM DailyPrices WHERE rn = 1
                )
                SELECT ScrapeDay, Ppd, PrevPpd
                FROM LatestPerDay
                WHERE PrevPpd IS NOT NULL
                ORDER BY ScrapeDay");

            var allRows = rows.ToList();
            if (allRows.Count == 0) return Results.Ok(Array.Empty<object>());

            // Group by day, count drops vs rises
            var dailyScores = allRows
                .GroupBy(r => ((DateTime)r.ScrapeDay).ToString("yyyy-MM-dd"))
                .Select(g =>
                {
                    var drops = g.Count(r => (decimal)r.Ppd < (decimal)r.PrevPpd);
                    var rises = g.Count(r => (decimal)r.Ppd > (decimal)r.PrevPpd);
                    var unchanged = g.Count(r => (decimal)r.Ppd == (decimal)r.PrevPpd);
                    var total = g.Count();
                    var rawScore = total > 0 ? Math.Round((double)(drops - rises) / total * -100, 1) : 0.0;
                    var avgPpd = (int)Math.Round(g.Average(r => (decimal)r.Ppd));
                    return new { Date = g.Key, RawScore = rawScore, Drops = drops, Rises = rises, Unchanged = unchanged, AvgPpd = avgPpd };
                })
                .OrderBy(d => d.Date)
                .ToList();

            // Apply 3-day simple moving average for smoothing
            var result = dailyScores.Select((d, i) =>
            {
                var window = dailyScores.Skip(Math.Max(0, i - 2)).Take(Math.Min(3, i + 1)).ToList();
                var smoothed = Math.Round(window.Average(w => w.RawScore), 1);
                return new
                {
                    d.Date,
                    d.RawScore,
                    SmoothedScore = smoothed,
                    d.Drops,
                    d.Rises,
                    d.Unchanged,
                    d.AvgPpd
                };
            }).ToList();

            return Results.Ok(result);
        });

    }
}
