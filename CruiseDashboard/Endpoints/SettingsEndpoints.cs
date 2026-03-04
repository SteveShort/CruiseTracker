// ═══════════════════════════════════════════════════════════════════════
// SettingsEndpoints.cs — Dashboard user settings persistence
//
// Routes:
//   GET  /api/settings                 → Load current settings
//   POST /api/settings                 → Merge-update settings (partial update, not full replace)
//
// Storage: dashboard-settings.json (disk-based, no DB)
// ═══════════════════════════════════════════════════════════════════════
using System.Text.Json;

namespace CruiseDashboard.Endpoints;

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this WebApplication app)
    {
        var settingsPath = Path.Combine(app.Environment.ContentRootPath, "dashboard-settings.json");

        app.MapGet("/api/settings", () => Results.Ok(LoadSettings(settingsPath)));

        app.MapPost("/api/settings", async (HttpRequest request) =>
        {
            var body = await JsonSerializer.DeserializeAsync<Dictionary<string, object>>(request.Body);
            if (body == null) return Results.BadRequest();
            var settings = LoadSettings(settingsPath);
            foreach (var kvp in body)
                settings[kvp.Key] = kvp.Value;
            SaveSettings(settingsPath, settings);
            return Results.Ok(settings);
        });
    }

    private static Dictionary<string, object> LoadSettings(string path)
    {
        if (!File.Exists(path)) return new Dictionary<string, object>();
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<Dictionary<string, object>>(json)
            ?? new Dictionary<string, object>();
    }

    private static void SaveSettings(string path, Dictionary<string, object> settings)
    {
        var json = JsonSerializer.Serialize(settings,
            new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(path, json);
    }
}
