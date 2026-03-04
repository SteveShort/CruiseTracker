// ═══════════════════════════════════════════════════════════════════════
// CalendarEndpoints.cs — Family calendar event CRUD
//
// Routes:
//   GET    /api/calendar-events        → List all calendar events
//   POST   /api/calendar-events        → Create a new event (auto-generates ID)
//   PUT    /api/calendar-events/{id}   → Update an existing event
//   DELETE /api/calendar-events/{id}   → Delete an event
//
// Storage: calendar-events.json (git-tracked, disk-based, no DB)
// Shared records: CalendarEvent (in Data/ShipReferenceData.cs)
// ═══════════════════════════════════════════════════════════════════════
using System.Text.Json;
using CruiseDashboard.Data;

namespace CruiseDashboard.Endpoints;

public static class CalendarEndpoints
{
    private static readonly JsonSerializerOptions _jsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    public static void MapCalendarEndpoints(this WebApplication app)
    {
        var calendarJsonPath = Path.Combine(app.Environment.ContentRootPath, "calendar-events.json");

        app.MapGet("/api/calendar-events", () => Results.Ok(LoadCalendarEvents(calendarJsonPath)));

        app.MapPost("/api/calendar-events", (CalendarEvent evt) =>
        {
            var events = LoadCalendarEvents(calendarJsonPath);
            var newEvt = evt with { Id = Guid.NewGuid().ToString("N")[..8] };
            events.Add(newEvt);
            SaveCalendarEvents(calendarJsonPath, events);
            return Results.Ok(newEvt);
        });

        app.MapDelete("/api/calendar-events/{id}", (string id) =>
        {
            var events = LoadCalendarEvents(calendarJsonPath);
            var removed = events.RemoveAll(e => e.Id == id);
            if (removed == 0) return Results.NotFound();
            SaveCalendarEvents(calendarJsonPath, events);
            return Results.Ok();
        });

        app.MapPut("/api/calendar-events/{id}", (string id, CalendarEvent evt) =>
        {
            var events = LoadCalendarEvents(calendarJsonPath);
            var idx = events.FindIndex(e => e.Id == id);
            if (idx < 0) return Results.NotFound();
            events[idx] = evt with { Id = id };
            SaveCalendarEvents(calendarJsonPath, events);
            return Results.Ok(events[idx]);
        });
    }

    private static List<CalendarEvent> LoadCalendarEvents(string path)
    {
        if (!File.Exists(path)) return new();
        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<List<CalendarEvent>>(json, _jsonOpts) ?? new();
        }
        catch { return new(); }
    }

    private static void SaveCalendarEvents(string path, List<CalendarEvent> events)
    {
        var json = JsonSerializer.Serialize(events, _jsonOpts);
        File.WriteAllText(path, json);
    }
}
