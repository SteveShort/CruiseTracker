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
            await page.WaitForSelectorAsync(".ship-filter", new() { Timeout = 30000 });
            
            Console.WriteLine(@"[DOM Sniffer] Filtering to Disney Treasure...");
            await page.ClickAsync(".filter-dropdown-btn");
            await page.ClickAsync("label:has-text('Disney Treasure')");
            await page.Keyboard.PressAsync("Escape");
            
            await page.WaitForTimeoutAsync(1500);
            
            Console.WriteLine(@"[DOM Sniffer] Expanding card...");
            var firstCard = page.Locator(".deal-card").First;
            await firstCard.ClickAsync();
            
            await page.WaitForSelectorAsync(".accordion-item", new() { Timeout = 10000 });
            await page.WaitForTimeoutAsync(1000); 

            Console.WriteLine(@"[DOM Sniffer] Capturing screenshot of collapsed accordions...");
            await page.ScreenshotAsync(new() { Path = @"c:\temp\treasure_card_dynamic_reports_collapsed.png", FullPage = false });
            
            Console.WriteLine(@"[DOM Sniffer] Expanding Package Report...");
            var packageHeader = page.Locator(".accordion-header >> text='Package Dining'");
            await packageHeader.ClickAsync();
            await page.WaitForTimeoutAsync(1000); 

            Console.WriteLine(@"[DOM Sniffer] Capturing screenshot of expanded Package Report...");
            await page.ScreenshotAsync(new() { Path = @"c:\temp\treasure_card_dynamic_reports.png", FullPage = false });

            Console.WriteLine(@"[DOM Sniffer] Done!");
            
        } catch (Exception ex) {
            Console.WriteLine("[Exception] " + ex.Message);
        }
    }
}
