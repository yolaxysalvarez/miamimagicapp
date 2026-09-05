// MiamiAhoraWidget.swift
// Miami Magic — widget de pantalla de inicio "Miami Ahora".
// Datos: Open-Meteo (clima y mar, sin llave) + hoy.json del sitio (opcional).
// Reemplaza COMPLETO el archivo que Xcode genera al crear el target.

import WidgetKit
import SwiftUI

// MARK: - Datos

struct AhoraEntry: TimelineEntry {
    let date: Date
    let tempF: Int?
    let waveFt: Double?
    let rainPct: Int?
    let sunset: String?      // "7:28 PM"
    let sunrise: String?
    let eventName: String?   // del hoy.json (opcional)
    let eventWhen: String?
    let isPlaceholder: Bool

    static let placeholder = AhoraEntry(
        date: Date(), tempF: 84, waveFt: 1.2, rainPct: 20,
        sunset: "7:28 PM", sunrise: "6:58 AM",
        eventName: nil, eventWhen: nil, isPlaceholder: true)
}

struct HoyJSON: Decodable {
    struct Ev: Decodable {
        let name: String; let name_es: String?; let when: String?; let when_es: String?
        let dates: [String]?      // días exactos "2026-09-17" (prioridad)
        let start: String?        // o un rango start…end (respaldo)
        let end: String?
    }
    let events: [Ev]?

    /// El evento que toca HOY: primero uno de día exacto; si no hay, el rango
    /// más corto que cubra la fecha. Sin coincidencia → nil (la línea no sale).
    func today(_ d: Date = Date()) -> Ev? {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "America/New_York")
        let hoy = f.string(from: d)
        guard let evs = events else { return nil }
        if let exact = evs.first(where: { $0.dates?.contains(hoy) == true }) { return exact }
        let ranges = evs.filter { e in
            guard let a = e.start, let b = e.end else { return false }
            return a <= hoy && hoy <= b
        }
        return ranges.min { ($0.end ?? "") < ($1.end ?? "") }   // el que termina antes
    }
}

enum AhoraAPI {
    static let forecast = URL(string:
        "https://api.open-meteo.com/v1/forecast?latitude=25.77&longitude=-80.19"
        + "&current=temperature_2m&daily=sunrise,sunset,precipitation_probability_max"
        + "&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=1")!
    static let marine = URL(string:
        "https://marine-api.open-meteo.com/v1/marine?latitude=25.77&longitude=-80.13"
        + "&current=wave_height&timezone=America%2FNew_York")!
    static let hoy = URL(string: "https://www.miamimagicapp.com/hoy.json")!

    static func fetch(_ url: URL) async -> [String: Any]? {
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, _) = try? await URLSession.shared.data(for: req) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func fetchHoy() async -> HoyJSON? {
        var req = URLRequest(url: hoy)
        req.timeoutInterval = 8
        guard let (data, _) = try? await URLSession.shared.data(for: req) else { return nil }
        return try? JSONDecoder().decode(HoyJSON.self, from: data)
    }

    /// "2026-09-04T19:28" -> "7:28 PM"
    static func clock(_ iso: String?) -> String? {
        guard let iso = iso, iso.count >= 16 else { return nil }
        let hm = iso.suffix(5)               // "19:28"
        let parts = hm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]) else { return nil }
        let m = String(parts[1])
        let h12 = h % 12 == 0 ? 12 : h % 12
        return "\(h12):\(m) \(h < 12 ? "AM" : "PM")"
    }

    static func load() async -> AhoraEntry {
        async let f = fetch(forecast)
        async let m = fetch(marine)
        async let h = fetchHoy()
        let fj = await f, mj = await m, hj = await h

        var tempF: Int? = nil, rain: Int? = nil, sunset: String? = nil, sunrise: String? = nil
        if let cur = fj?["current"] as? [String: Any], let t = cur["temperature_2m"] as? Double {
            tempF = Int(t.rounded())
        }
        if let d = fj?["daily"] as? [String: Any] {
            if let r = (d["precipitation_probability_max"] as? [Any])?.first as? Double { rain = Int(r) }
            sunset  = clock((d["sunset"]  as? [String])?.first)
            sunrise = clock((d["sunrise"] as? [String])?.first)
        }
        var waveFt: Double? = nil
        if let cur = mj?["current"] as? [String: Any], let w = cur["wave_height"] as? Double {
            waveFt = (w * 3.281 * 10).rounded() / 10
        }
        let es = Locale.current.language.languageCode?.identifier == "es"
        var evName: String? = nil, evWhen: String? = nil
        if let e = hj?.today() {
            evName = es ? (e.name_es ?? e.name) : e.name
            evWhen = es ? (e.when_es ?? e.when) : e.when
        }
        return AhoraEntry(date: Date(), tempF: tempF, waveFt: waveFt, rainPct: rain,
                          sunset: sunset, sunrise: sunrise,
                          eventName: evName, eventWhen: evWhen, isPlaceholder: false)
    }
}

// MARK: - Provider

struct AhoraProvider: TimelineProvider {
    func placeholder(in context: Context) -> AhoraEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (AhoraEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await AhoraAPI.load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AhoraEntry>) -> Void) {
        Task {
            let entry = await AhoraAPI.load()
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

// MARK: - Textos

struct AhoraText {
    static var es: Bool { Locale.current.language.languageCode?.identifier == "es" }

    static func greeting(_ d: Date) -> String {
        let h = Calendar.current.component(.hour, from: d)
        if es { return h < 12 ? "Buenos días, Miami" : (h < 19 ? "Buenas tardes, Miami" : "Buenas noches, Miami") }
        return h < 12 ? "Good morning, Miami" : (h < 19 ? "Good afternoon, Miami" : "Good evening, Miami")
    }

    static func sea(_ ft: Double?) -> String {
        guard let ft = ft else { return es ? "Mar —" : "Sea —" }
        let word: String
        switch ft {
        case ..<1.5: word = es ? "Mar plano"  : "Flat sea"
        case ..<2.5: word = es ? "Mar ligero" : "Light sea"
        case ..<3.5: word = es ? "Mar movido" : "Moderate sea"
        default:     word = es ? "Mar picado" : "Choppy sea"
        }
        return "\(word) · \(ft) ft"
    }

    static var eyebrow: String { es ? "MIAMI AHORA" : "MIAMI NOW" }
    static var sunsetLbl: String { es ? "Atardecer" : "Sunset" }
    static var rainLbl: String { es ? "Lluvia" : "Rain" }
    static var todayLbl: String { es ? "HOY" : "TODAY" }
}

// MARK: - Colores de la marca

extension Color {
    static let mmNavy  = Color(red: 0.055, green: 0.106, blue: 0.188)   // #0E1B30
    static let mmNavy2 = Color(red: 0.043, green: 0.082, blue: 0.149)   // #0B1526
    static let mmCoral = Color(red: 1.00,  green: 0.302, blue: 0.208)   // #FF4D35
    static let mmTeal  = Color(red: 0.00,  green: 0.788, blue: 0.694)   // #00C9B1
    static let mmGold  = Color(red: 1.00,  green: 0.820, blue: 0.400)   // #FFD166
    static let mmCream = Color(red: 1.00,  green: 0.941, blue: 0.878)   // #FFF0E0
}

// MARK: - Vistas

/// Fondo de marca: navy en degradado + brillo dorado en la esquina (como las
/// tarjetas de Explorar en la app).
struct AhoraBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [.mmNavy, .mmNavy2], startPoint: .topLeading, endPoint: .bottomTrailing)
            RadialGradient(colors: [Color.mmGold.opacity(0.22), .clear],
                           center: .topTrailing, startRadius: 0, endRadius: 150)
        }
    }
}

struct AhoraEyebrow: View {
    var body: some View {
        HStack(spacing: 7) {
            RoundedRectangle(cornerRadius: 1.5).fill(Color.mmCoral).frame(width: 3, height: 13)
            Text(AhoraText.eyebrow)
                .font(.system(size: 11, weight: .heavy)).tracking(2.4).foregroundColor(.mmGold)
        }
    }
}

struct AhoraTemp: View {
    let tempF: Int?
    let size: CGFloat
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(tempF.map { "\($0)" } ?? "\u{2014}")
                .font(.system(size: size, weight: .bold, design: .serif)).foregroundColor(.mmCream)
            Text("\u{00B0}F")
                .font(.system(size: size * 0.34, weight: .bold)).foregroundColor(.mmCream.opacity(0.75))
        }
    }
}

struct AhoraSmall: View {
    let e: AhoraEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AhoraEyebrow()
            Spacer(minLength: 0)
            AhoraTemp(tempF: e.tempF, size: 56)
                .padding(.bottom, 6)
            Label(AhoraText.sea(e.waveFt), systemImage: "water.waves")
                .font(.system(size: 14, weight: .bold)).foregroundColor(.mmTeal)
                .lineLimit(1).minimumScaleFactor(0.8)
            if let s = e.sunset {
                Label("\(AhoraText.sunsetLbl) \(s)", systemImage: "sunset.fill")
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(.mmCream.opacity(0.9))
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .padding(.top, 5)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct AhoraMedium: View {
    let e: AhoraEntry
    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                AhoraEyebrow()
                Text(AhoraText.greeting(e.date))
                    .font(.system(size: 18, weight: .bold, design: .serif)).foregroundColor(.mmCream)
                    .lineLimit(1).minimumScaleFactor(0.75)
                Spacer(minLength: 0)
                AhoraTemp(tempF: e.tempF, size: 46)
                Label(AhoraText.sea(e.waveFt), systemImage: "water.waves")
                    .font(.system(size: 13, weight: .bold)).foregroundColor(.mmTeal)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            RoundedRectangle(cornerRadius: 1).fill(Color.mmCream.opacity(0.14)).frame(width: 1)

            VStack(alignment: .leading, spacing: 10) {
                if let s = e.sunset {
                    stat(icon: "sunset.fill", label: AhoraText.sunsetLbl, value: s, tint: .mmGold)
                }
                if let r = e.rainPct {
                    stat(icon: "cloud.rain.fill", label: AhoraText.rainLbl, value: "\(r)%", tint: .mmTeal)
                }
                if let n = e.eventName {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(AhoraText.todayLbl)
                            .font(.system(size: 9, weight: .heavy)).tracking(1.8).foregroundColor(.mmCoral)
                        Text(n).font(.system(size: 13, weight: .bold)).foregroundColor(.mmCream)
                            .lineLimit(2).minimumScaleFactor(0.85)
                        if let w = e.eventWhen {
                            Text(w).font(.system(size: 11)).foregroundColor(.mmCream.opacity(0.7)).lineLimit(1)
                        }
                    }
                } else {
                    Text("Miami Magic")
                        .font(.system(size: 13, weight: .bold, design: .serif)).foregroundColor(.mmCream.opacity(0.6))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    func stat(icon: String, label: String, value: String, tint: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 14)).foregroundColor(tint)
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.system(size: 10, weight: .semibold)).foregroundColor(.mmCream.opacity(0.6))
                Text(value).font(.system(size: 15, weight: .bold)).foregroundColor(.mmCream)
            }
        }
    }
}

struct AhoraWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: AhoraEntry
    var body: some View {
        Group {
            switch family {
            case .systemMedium: AhoraMedium(e: entry)
            default:            AhoraSmall(e: entry)
            }
        }
        .containerBackground(for: .widget) { AhoraBackground() }
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
    }
}

// MARK: - Widget

struct MiamiAhoraWidget: Widget {
    let kind = "MiamiAhoraWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AhoraProvider()) { entry in
            AhoraWidgetView(entry: entry)
        }
        .configurationDisplayName(AhoraText.es ? "Miami Ahora" : "Miami Now")
        .description(AhoraText.es
            ? "Clima, estado del mar, atardecer y el dato del día."
            : "Weather, sea state, sunset and today's pick.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}

// MARK: - Punto de entrada del extension

@main
struct MiamiAhoraWidgetBundle: WidgetBundle {
    var body: some Widget {
        MiamiAhoraWidget()
    }
}

#Preview(as: .systemMedium) {
    MiamiAhoraWidget()
} timeline: {
    AhoraEntry.placeholder
}
