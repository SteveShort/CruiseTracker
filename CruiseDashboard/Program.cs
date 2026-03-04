// ═══════════════════════════════════════════════════════════════════════
// Program.cs — Application entry point and orchestrator
//
// This file ONLY handles startup, shared state init, and endpoint registration.
// All API route handlers are in Endpoints/*.cs:
//   Endpoints/DashboardEndpoints.cs  → /api/stats, /api/cruises, /api/hot-deals, /api/analytics, etc.
//   Endpoints/ShipEndpoints.cs       → /api/ship-rating, /api/restaurants
//   Endpoints/CalendarEndpoints.cs   → /api/calendar-events (CRUD)
//   Endpoints/SettingsEndpoints.cs   → /api/settings
//
// Shared data types:   Data/ShipReferenceData.cs (ShipInfo, RestaurantData, RatingUpdate, CalendarEvent)
// Ship fleet data:     Data/ShipReferenceData.cs (CreateShipDictionary, LookupShip, LinesForMode)
// ═══════════════════════════════════════════════════════════════════════
using Dapper;
using Microsoft.Data.SqlClient;
using CruiseDashboard.Data;
using CruiseDashboard.Endpoints;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.UseDeveloperExceptionPage();

var env = app.Environment;
Console.WriteLine($"[DEBUG] App started. Environment: {env.EnvironmentName}");
Console.WriteLine($"[DEBUG] ContentRootPath: {env.ContentRootPath}");
Console.WriteLine($"[DEBUG] WebRootPath: {env.WebRootPath}");

var connectionString = @"Server=STEVEOFFICEPC\ORACLE2SQL;Database=CruiseTracker;User Id=CruiseDashboard;Password=Cruise2026!Tracker;TrustServerCertificate=True;";

app.UseStaticFiles();

// ── Ship Reference (loaded from Data/ShipReferenceData.cs) ─────────────
var ships = ShipReferenceData.CreateShipDictionary();

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

// Override the hardcoded ShipInfo with computed ratings from restaurant data
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

// ── Register API Endpoints ─────────────────────────────────────────────
app.MapDashboardEndpoints(connectionString, ships, allRestaurants);
app.MapShipEndpoints(connectionString, ships, allRestaurants);
app.MapCalendarEndpoints();
app.MapSettingsEndpoints();

app.Run();
