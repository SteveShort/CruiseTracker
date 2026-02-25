using System;
using System.Threading.Tasks;
using Microsoft.Playwright;

class Program
{
    static async Task Main()
    {
        Console.WriteLine(@"[DOM Sniffer] Starting...");
        using var playwright = await Playwright.CreateAsync();
        await using var browser = await playwright.Chromium.LaunchAsync(new() { Headless = true });
        var page = await browser.NewPageAsync(new() { ViewportSize = new ViewportSize { Width = 1440, Height = 900 }});
        
        try {
            Console.WriteLine(@"[DOM Sniffer] Navigating to localhost:5050...");
            await page.GotoAsync("http://localhost:5050/");
            await page.WaitForSelectorAsync(".deal-card", new() { Timeout = 30000 });
            
            Console.WriteLine(@"[DOM Sniffer] Clicking first deal card...");
            var firstCard = page.Locator(".deal-card").First;
            await firstCard.ClickAsync();
            
            // Wait for accordion and grid to render
            await page.WaitForSelectorAsync(".restaurant-grid", new() { Timeout = 10000 });
            await page.WaitForTimeoutAsync(2000); // Give it time to fetch and animate
            
            Console.WriteLine(@"[DOM Sniffer] Capturing screenshot...");
            await page.ScreenshotAsync(new() { Path = @"c:\temp\restaurant_grid_4col.png", FullPage = false });
            Console.WriteLine(@"[DOM Sniffer] Done!");
            
        } catch (Exception ex) {
            Console.WriteLine("[Exception] " + ex.Message);
        }
    }
}
