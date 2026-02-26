using System;
using System.Text.Json;
class Program {
    static void Main() {
        var json = "{\"shipClass\": \"Magic\", \"kidsScore\": 85}\";
        var el = JsonDocument.Parse(json).RootElement;
        try { el.GetProperty("kidsScore"); } catch { Console.WriteLine("kidsScore failed"); }
        try { el.GetProperty("shipScore"); } catch { Console.WriteLine("shipScore failed"); }
    }
}
