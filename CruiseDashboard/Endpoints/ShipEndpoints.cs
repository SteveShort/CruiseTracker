// ═══════════════════════════════════════════════════════════════════════
// ShipEndpoints.cs — Ship ratings and restaurant data management
//
// Routes:
//   PUT  /api/ship-rating/{shipName}   → Update a ship's quality scores (in-memory)
//   GET  /api/restaurants/{shipName}   → Get restaurant evaluations for a ship
//   PUT  /api/restaurants/{id}         → Update restaurant score + recalculate ship dining scores
//
// Dependencies: connectionString, ships dictionary, allRestaurants cache
// Shared records: ShipInfo, RestaurantData, RatingUpdate (in Data/ShipReferenceData.cs)
// ═══════════════════════════════════════════════════════════════════════
using Dapper;
using Microsoft.Data.SqlClient;
using CruiseDashboard.Data;

namespace CruiseDashboard.Endpoints;

public static class ShipEndpoints
{
    public static void MapShipEndpoints(this WebApplication app,
        string connStr,
        Dictionary<string, ShipInfo> ships,
        Dictionary<string, List<RestaurantData>> allRestaurants)
    {
        
        // PUT /api/ship-rating/{shipName} â€” Update a ship's rating
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
        
        // GET /api/restaurants/{shipName} â€” Get detailed dining evaluations
        app.MapGet("/api/restaurants/{shipName}", (string shipName) =>
        {
            var key = allRestaurants.Keys.FirstOrDefault(k => k.Equals(shipName, StringComparison.OrdinalIgnoreCase));
            if (key == null) return Results.Ok(new List<RestaurantData>()); // Return empty array if not found
            return Results.Ok(allRestaurants[key]);
        });
        
        // PUT /api/restaurants/{id} â€” Update a specific restaurant
        app.MapPut("/api/restaurants/{id}", async (int id, RestaurantData body) =>
        {
            using var conn = new SqlConnection(connStr);
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
    }
}
