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
//   GET  /api/hot-deals               → Multi-signal heat-scored deals (price drop, peer outlier, quality-price gap)
//   GET  /api/analytics               → Chart data (by-line, by-ship, departure curve, monthly heatmap)
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
        
        // GET /api/hot-deals â€” cruises with exceptional value (multi-signal heat scoring)
        app.MapGet("/api/hot-deals", async (string? appMode) =>
        {
            using var conn = new SqlConnection(connStr);
            var modeLines = ShipReferenceData.LinesForMode(ships, appMode);
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
                      AND ph2.ScrapedAt >= '2026-02-28'
                ) hist
                WHERE c.IsDeparted = 0 AND c.DepartureDate >= CAST(GETDATE() AS DATE)
                  AND c.CruiseLine IN ({lineFilter})
                  AND p.BalconyPerDay > 0
                  AND p.ScrapedAt > DATEADD(hour, -36, (SELECT MaxScrapedAt FROM LatestScrapes ls WHERE ls.CruiseLine = c.CruiseLine))
                  AND (c.Itinerary IS NULL OR c.Itinerary NOT LIKE '%transatlantic%')
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
                            var si = ShipReferenceData.LookupShip(ships, (string)r.ShipName);
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
                        reasons.Add($"ðŸ“‰ {(int)dropPct}% price drop from peak (${(int)peakPpd}/ppd â†’ ${(int)ppd})");
                    }
                    else if (dropPct >= 15)
                    {
                        heatScore += 1;
                        reasons.Add($"ðŸ“‰ {(int)dropPct}% price drop from peak");
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
                        reasons.Add($"ðŸ“Š Bottom 10% for {nights}-night {line} (${(int)ppd} vs median ${(int)peer.Median})");
                    }
                    else if (ppd <= peer.P25)
                    {
                        heatScore += 1;
                        reasons.Add($"ðŸ“Š Bottom 25% for {nights}-night {line}");
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
                            reasons.Add($"ðŸ† Top-tier ship (ship:{shipQ} dining:{dinQ}) at rock-bottom price");
                        }
                        else
                        {
                            heatScore += 1;
                            reasons.Add($"ðŸ† Top-tier ship (ship:{shipQ} dining:{dinQ}) at below-average price");
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
            .ToList();
        
            return Results.Ok(scored);
        });
        
        // GET /api/analytics â€” pricing statistics for charts
        app.MapGet("/api/analytics", async (string? appMode, string? priceType) =>
        {
            using var conn = new SqlConnection(connStr);
            var modeLines = ShipReferenceData.LinesForMode(ships, appMode);
            var lineFilter = string.Join(",", modeLines.Select(l => $"'{l}'"));
            var minDate = "2026-02-28"; // Exclude pre-2/28 cruise.com data
            var priceCol = priceType == "suite" ? "SuitePerDay" : "BalconyPerDay";
        
            // 1. Per-line averages
            var byLine = await conn.QueryAsync<dynamic>($@"
                SELECT CruiseLine, AVG({priceCol}) AS AvgPpd, MIN({priceCol}) AS MinPpd,
                       COUNT(DISTINCT CONCAT(ShipName,'|',DepartureDate)) AS Sailings
                FROM PriceHistory
                WHERE {priceCol} > 0 AND ScrapedAt >= '{minDate}'
                  AND CruiseLine IN ({lineFilter})
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
                      AND CruiseLine IN ({lineFilter})
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
                  AND ph.CruiseLine IN ({lineFilter})
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
                      AND ph.CruiseLine IN ({lineFilter})
                      AND ph.DepartureDate >= CAST(GETDATE() AS DATE)
                      AND (c.Itinerary IS NULL OR c.Itinerary NOT LIKE '%transatlantic%')
                )
                SELECT CruiseLine,
                       YEAR(DepartureDate) AS Yr, MONTH(DepartureDate) AS Mo,
                       CAST(AVG(PricePerDay) AS int) AS AvgPpd, COUNT(*) AS Sailings
                FROM LatestPrice WHERE rn = 1
                GROUP BY CruiseLine, YEAR(DepartureDate), MONTH(DepartureDate)
                ORDER BY Yr, Mo, CruiseLine");
        
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
                monthly = monthly.Select(r => new { CruiseLine = (string)r.CruiseLine, Year = (int)r.Yr, Month = (int)r.Mo, AvgPpd = (int)r.AvgPpd, Sailings = (int)r.Sailings })
            });
        });
        
    }
}
