using System.Text.Json;
using Microsoft.Playwright.NUnit;
using NUnit.Framework;

namespace CruiseDashboard.Tests;

[Parallelizable(ParallelScope.Self)]
[TestFixture]
public class DashboardTests : PageTest
{
    private const string BaseUrl = "http://localhost:5050";

    /// <summary>
    /// Verifies the dashboard loads and the sailing-count stat card shows a
    /// number that matches the number of rendered cruise cards (after default
    /// filters: hide sold-out, kids-only, hide transatlantic).
    /// </summary>
    [Test]
    public async Task Dashboard_LoadsAndShowsSailingCount()
    {
        await Page.GotoAsync(BaseUrl);

        // Wait for the stat card to contain a real number (not the placeholder "—")
        var statSailings = Page.Locator("#statSailings");
        await Expect(statSailings).Not.ToHaveTextAsync("—", new() { Timeout = 15_000 });
        await Expect(statSailings).Not.ToHaveTextAsync("Loading...", new() { Timeout = 5_000 });

        var sailingText = await statSailings.InnerTextAsync();
        var sailingCount = int.Parse(sailingText.Replace(",", ""));

        // The stat card should show a positive number
        Assert.That(sailingCount, Is.GreaterThan(0),
            "Stat card should show at least 1 upcoming sailing");

        // The count in the stat card should match the number of rendered cards
        var cards = Page.Locator("#dealsContainer .deal-card");
        await Expect(cards.First).ToBeVisibleAsync(new() { Timeout = 10_000 });
        var cardCount = await cards.CountAsync();

        Assert.That(cardCount, Is.GreaterThan(0),
            "Should render at least 1 card");
        Assert.That(cardCount, Is.LessThanOrEqualTo(sailingCount),
            $"Card count ({cardCount}) should be <= stat card ({sailingCount}) due to pagination");
    }

    /// <summary>
    /// Verifies cruise cards render and the result-count label is consistent.
    /// </summary>
    [Test]
    public async Task Dashboard_ShowsCruiseCards()
    {
        await Page.GotoAsync(BaseUrl);

        try 
        {
            // Wait for cards to render
            var cards = Page.Locator("#dealsContainer .deal-card");
            await Expect(cards.First).ToBeVisibleAsync(new() { Timeout = 15_000 });

            var cardCount = await cards.CountAsync();
            Assert.That(cardCount, Is.GreaterThan(0), "Should have at least one cruise card");

            // The result count label should say "<N> options"
            var resultLabel = Page.Locator("#dashResultCount");
            var labelText = await resultLabel.InnerTextAsync();
            Assert.That(labelText, Does.Match(@"^\d+ options$"),
                $"Result count label should be '<N> options', got '{labelText}'");

            // Parse and verify consistency
            var labelCount = int.Parse(labelText.Split(' ')[0]);
            Assert.That(labelCount, Is.GreaterThanOrEqualTo(cardCount),
                "Result count label should be >= rendered card count (pagination)");
        } 
        catch (Exception) 
        {
            await Page.ScreenshotAsync(new() { Path = "c:\\temp\\dashboard_test_fail.png" });
            throw;
        }
    }

    /// <summary>
    /// Lightweight API check: fetches /api/cruises directly and validates the
    /// JSON array is non-empty with expected fields.
    /// </summary>
    [Test]
    public async Task Api_CruisesReturnsData()
    {
        var response = await Page.APIRequest.GetAsync($"{BaseUrl}/api/cruises");
        Assert.That(response.Ok, Is.True, "API should return 200 OK");

        var body = await response.JsonAsync();
        Assert.That(body, Is.Not.Null);

        var array = body?.EnumerateArray().ToList();
        Assert.That(array, Is.Not.Null);
        Assert.That(array!.Count, Is.GreaterThan(0), "API should return at least 1 cruise");

        // Verify first item has expected fields
        var first = array[0];
        Assert.Multiple(() =>
        {
            Assert.That(first.TryGetProperty("shipName", out _), Is.True, "Missing shipName");
            Assert.That(first.TryGetProperty("cruiseLine", out _), Is.True, "Missing cruiseLine");
            Assert.That(first.TryGetProperty("departureDate", out _), Is.True, "Missing departureDate");
            Assert.That(first.TryGetProperty("nights", out _), Is.True, "Missing nights");
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Round 2 — Dashboard & Calendar focused tests
    // ═══════════════════════════════════════════════════════════════

    /// <summary>
    /// Applies the "Disney" cruise line filter and verifies the card count
    /// drops compared to the unfiltered default view.
    /// </summary>
    [Test]
    public async Task Dashboard_FilterReducesCardCount()
    {
        await Page.GotoAsync(BaseUrl);

        // Wait for initial cards to load
        var cards = Page.Locator("#dealsContainer .deal-card");
        await Expect(cards.First).ToBeVisibleAsync(new() { Timeout = 15_000 });

        // Read the initial total from the result count label (not DOM cards — pagination caps those)
        var initialLabel = await Page.Locator("#dashResultCount").InnerTextAsync();
        var initialTotal = int.Parse(initialLabel.Split(' ')[0]);

        // Apply "Disney" cruise line filter
        await Page.ClickAsync("#lineDropdown .dropdown-toggle");
        await Page.ClickAsync("#dashFilterLinePanel input[value='Disney']");
        await Page.ClickAsync("body", new() { Position = new Microsoft.Playwright.Position { X = 0, Y = 0 } });

        // Wait for re-render
        await Page.WaitForTimeoutAsync(500);

        var filteredLabel = await Page.Locator("#dashResultCount").InnerTextAsync();
        var filteredTotal = int.Parse(filteredLabel.Split(' ')[0]);
        var filteredCardCount = await cards.CountAsync();

        Assert.Multiple(() =>
        {
            Assert.That(filteredTotal, Is.LessThan(initialTotal),
                $"Disney filter should reduce total from {initialTotal}");
            Assert.That(filteredCardCount, Is.GreaterThan(0),
                "Disney filter should still show at least 1 card");
            Assert.That(filteredTotal, Is.GreaterThanOrEqualTo(filteredCardCount),
                "Result label should be >= rendered card count (pagination)");
        });
    }

    /// <summary>
    /// Every cruise returned by /api/cruises should have a known ship class
    /// and ratings. If the scraper picks up a ship not in the in-memory
    /// dictionary, these fields silently degrade to "Unknown" / "?".
    /// </summary>
    [Test]
    public async Task Api_AllCruisesHaveKnownShipData()
    {
        var response = await Page.APIRequest.GetAsync($"{BaseUrl}/api/cruises");
        Assert.That(response.Ok, Is.True);

        var body = await response.JsonAsync();
        var cruises = body?.EnumerateArray().ToList();
        Assert.That(cruises, Is.Not.Null);
        Assert.That(cruises!.Count, Is.GreaterThan(0));

        var unknownShips = cruises
            .Where(c => 
                c.GetProperty("shipClass").GetString() == "Unknown" ||
                c.GetProperty("kidsScore").GetInt32() == 0 ||
                c.GetProperty("shipScore").GetInt32() == 0 ||
                c.GetProperty("mainDiningScore").GetInt32() == 0 ||
                c.GetProperty("packageDiningScore").GetInt32() == 0)
            .Select(c => c.GetProperty("shipName").GetString())
            .Distinct()
            .ToList();

        Assert.That(unknownShips, Is.Empty,
            $"These ships are missing from the in-memory dictionary: {string.Join(", ", unknownShips)}");
    }

    /// <summary>
    /// Switches to the Calendar tab and verifies the calendar grid renders
    /// day cells and the event list section is present.
    /// </summary>
    [Test]
    public async Task Calendar_TabRendersGrid()
    {
        await Page.GotoAsync(BaseUrl);

        // Wait for initial load to complete
        var cards = Page.Locator("#dealsContainer .deal-card");
        await Expect(cards.First).ToBeVisibleAsync(new() { Timeout = 15_000 });

        // Click the Calendar tab
        await Page.ClickAsync("[data-tab='calendar']");

        // Verify the calendar tab is now active
        var calTab = Page.Locator("#tab-calendar");
        await Expect(calTab).ToHaveClassAsync(new System.Text.RegularExpressions.Regex("active"));

        // Verify calendar grid has day cells (at least 28 for any month)
        var dayCells = Page.Locator("#calGrid .cal-day:not(.empty)");
        await Expect(dayCells.First).ToBeVisibleAsync(new() { Timeout = 5_000 });
        var dayCount = await dayCells.CountAsync();
        Assert.That(dayCount, Is.GreaterThanOrEqualTo(28),
            $"Calendar should show at least 28 days, got {dayCount}");

        // Verify the month title is showing (not empty)
        var monthTitle = await Page.Locator("#calTitle").InnerTextAsync();
        Assert.That(monthTitle, Is.Not.Empty, "Calendar month title should not be empty");

        // Verify event list section exists
        await Expect(Page.Locator("#calEventList")).ToBeVisibleAsync();
    }

    /// <summary>
    /// Verifies all 4 stat cards show real values, not placeholders.
    /// Catches API/DB failures that leave the dashboard looking alive but empty.
    /// </summary>
    [Test]
    public async Task Dashboard_StatCardsShowRealData()
    {
        await Page.GotoAsync(BaseUrl);

        // Wait for data to load
        var cards = Page.Locator("#dealsContainer .deal-card");
        await Expect(cards.First).ToBeVisibleAsync(new() { Timeout = 15_000 });

        // All 4 stat cards should have real values
        var statIds = new[] { "statSailings", "statShips", "statBalcony", "statSuite" };

        foreach (var id in statIds)
        {
            var text = await Page.Locator($"#{id}").InnerTextAsync();
            Assert.That(text, Is.Not.EqualTo("—"),
                $"Stat card #{id} should not show placeholder '—'");
            Assert.That(text, Is.Not.EqualTo("Loading..."),
                $"Stat card #{id} should not show 'Loading...'");
            Assert.That(text.Trim(), Is.Not.Empty,
                $"Stat card #{id} should not be empty");
        }

        // Sailings and Ships should be numeric
        var sailingsText = await Page.Locator("#statSailings").InnerTextAsync();
        Assert.That(int.TryParse(sailingsText.Replace(",", ""), out var sailings) && sailings > 0,
            Is.True, $"statSailings should be a positive number, got '{sailingsText}'");

        var shipsText = await Page.Locator("#statShips").InnerTextAsync();
        Assert.That(int.TryParse(shipsText.Replace(",", ""), out var ships) && ships > 0,
            Is.True, $"statShips should be a positive number, got '{shipsText}'");

        // Balcony and Suite should start with '$'
        var balconyText = await Page.Locator("#statBalcony").InnerTextAsync();
        Assert.That(balconyText, Does.StartWith("$"),
            $"statBalcony should be a dollar amount, got '{balconyText}'");

        var suiteText = await Page.Locator("#statSuite").InnerTextAsync();
        Assert.That(suiteText, Does.StartWith("$"),
            $"statSuite should be a dollar amount, got '{suiteText}'");
    }

    // ═══════════════════════════════════════════════════════════════
    //  Round 3 — API Data Integrity (no departed cruises)
    // ═══════════════════════════════════════════════════════════════

    /// <summary>
    /// Verifies /api/cruises never returns a cruise with a departure date
    /// in the past. The server should filter these at the SQL level.
    /// </summary>
    [Test]
    public async Task Api_CruisesNeverReturnsPastDepartures()
    {
        var response = await Page.APIRequest.GetAsync($"{BaseUrl}/api/cruises");
        Assert.That(response.Ok, Is.True);

        var body = await response.JsonAsync();
        var cruises = body?.EnumerateArray().ToList();
        Assert.That(cruises, Is.Not.Null);
        Assert.That(cruises!.Count, Is.GreaterThan(0));

        var today = DateTime.Today;
        var pastCruises = cruises
            .Where(c =>
            {
                var dateStr = c.GetProperty("departureDate").GetString();
                return DateTime.TryParse(dateStr, out var dep) && dep < today;
            })
            .Select(c => $"{c.GetProperty("cruiseLine").GetString()} {c.GetProperty("shipName").GetString()} {c.GetProperty("departureDate").GetString()}")
            .ToList();

        Assert.That(pastCruises, Is.Empty,
            $"API returned {pastCruises.Count} past-date cruises: {string.Join("; ", pastCruises.Take(5))}");
    }

    /// <summary>
    /// Verifies /api/cruises with mode=suite only returns cruises that have
    /// suite pricing (SuitePerDay > 0 or VerifiedSuitePerDay > 0).
    /// Disney sailings with no suite tier should be excluded.
    /// </summary>
    [Test]
    public async Task Api_SuiteModeExcludesNoSuiteSailings()
    {
        var response = await Page.APIRequest.GetAsync($"{BaseUrl}/api/cruises?mode=suite");
        Assert.That(response.Ok, Is.True);

        var body = await response.JsonAsync();
        var cruises = body?.EnumerateArray().ToList();
        Assert.That(cruises, Is.Not.Null);
        Assert.That(cruises!.Count, Is.GreaterThan(0), "Suite mode should still return cruises");

        var noSuiteCruises = cruises
            .Where(c =>
            {
                var suitePpd = c.GetProperty("suitePerDay").GetDecimal();
                var verifiedSuitePpd = c.TryGetProperty("verifiedSuitePerDay", out var vsp) && vsp.ValueKind != JsonValueKind.Null
                    ? vsp.GetDecimal() : 0m;
                return suitePpd <= 0 && verifiedSuitePpd <= 0;
            })
            .Select(c => $"{c.GetProperty("cruiseLine").GetString()} {c.GetProperty("shipName").GetString()}")
            .ToList();

        Assert.That(noSuiteCruises, Is.Empty,
            $"Suite mode returned {noSuiteCruises.Count} cruises with no suite price: {string.Join("; ", noSuiteCruises.Take(5))}");

        // Disney should not appear at all in suite mode (they have no suite tier)
        var disneyInSuiteMode = cruises
            .Where(c => c.GetProperty("cruiseLine").GetString() == "Disney")
            .Select(c => c.GetProperty("shipName").GetString())
            .Distinct()
            .ToList();

        Assert.That(disneyInSuiteMode, Is.Empty,
            $"Suite mode should not include Disney sailings, but found: {string.Join(", ", disneyInSuiteMode)}");
    }

    /// <summary>
    /// Verifies /api/cruises without mode parameter returns more results
    /// than with mode=suite, confirming the server-side filter is applied.
    /// </summary>
    [Test]
    public async Task Api_SuiteModeReturnsFewerResults()
    {
        var allResponse = await Page.APIRequest.GetAsync($"{BaseUrl}/api/cruises");
        var suiteResponse = await Page.APIRequest.GetAsync($"{BaseUrl}/api/cruises?mode=suite");

        Assert.That(allResponse.Ok, Is.True);
        Assert.That(suiteResponse.Ok, Is.True);

        var allBody = await allResponse.JsonAsync();
        var suiteBody = await suiteResponse.JsonAsync();

        var allCount = allBody?.EnumerateArray().Count() ?? 0;
        var suiteCount = suiteBody?.EnumerateArray().Count() ?? 0;

        Assert.That(allCount, Is.GreaterThan(suiteCount),
            $"Default mode ({allCount}) should return more cruises than suite mode ({suiteCount})");
        Assert.That(suiteCount, Is.GreaterThan(0),
            "Suite mode should still return some cruises");
    }

    /// <summary>
    /// Verifies /api/deals never returns departed or past-date cruises.
    /// </summary>
    [Test]
    public async Task Api_DealsNeverReturnsPastDepartures()
    {
        var response = await Page.APIRequest.GetAsync($"{BaseUrl}/api/deals");
        Assert.That(response.Ok, Is.True);

        var body = await response.JsonAsync();
        var deals = body?.EnumerateArray().ToList();
        if (deals == null || deals.Count == 0)
        {
            Assert.Pass("No deals returned — nothing to validate");
            return;
        }

        var today = DateTime.Today;
        var pastDeals = deals
            .Where(d =>
            {
                if (!d.TryGetProperty("departureDate", out var dp)) return false;
                var dateStr = dp.GetString();
                return DateTime.TryParse(dateStr, out var dep) && dep < today;
            })
            .Select(d => $"{d.GetProperty("shipName").GetString()} {d.GetProperty("departureDate").GetString()}")
            .ToList();

        Assert.That(pastDeals, Is.Empty,
            $"Deals API returned {pastDeals.Count} past-date cruises: {string.Join("; ", pastDeals.Take(5))}");
    }
}
