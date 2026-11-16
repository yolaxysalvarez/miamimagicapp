// MiamiAhoraWidget.swift
// Miami Magic — widget de pantalla de inicio: "La postal del día" (v2.0).
// Cada día un lugar de la app con su foto, alternando Miami y los Cayos.
// Datos: postal.json del sitio (lugares y fotos) + Open-Meteo (clima y mar, sin llave).
// Al tocarlo abre la ficha del lugar: miamimagic://ficha?mt=…&id=…
// Reemplaza COMPLETO el archivo anterior del target del widget.

import WidgetKit
import SwiftUI
import UIKit

// MARK: - Datos

struct Postal: Decodable {
    let id: String
    let mt: String            // tipo de ficha en la app (beach, place, park, rest, keys)
    let scope: String         // "miami" | "keys"
    let name: String
    let name_es: String?
    let line: String?
    let line_es: String?
    let foto: String
    let fx: Double?           // punto de interés de la foto (0–1)
    let fy: Double?
}
struct PostalFile: Decodable { let postales: [Postal] }

struct PostalEntry: TimelineEntry {
    let date: Date
    let postal: Postal?
    let image: UIImage?
    let palm: UIImage?
    let tempF: Int?
    let seaF: Int?
    let sunset: String?       // "5:32"
    let isPlaceholder: Bool

    static let placeholder = PostalEntry(
        date: Date(),
        postal: Postal(id: "b15", mt: "beach", scope: "miami",
                       name: "Cape Florida Lighthouse", name_es: "El faro de Key Biscayne",
                       line: "Key Biscayne", line_es: "Key Biscayne",
                       foto: "", fx: 0.5, fy: 0.3),
        image: nil, palm: nil, tempF: 79, seaF: 78, sunset: "5:32", isPlaceholder: true)
}

enum PostalAPI {
    static let site = "https://www.miamimagicapp.com"
    static let ny = TimeZone(identifier: "America/New_York")!

    static func json(_ s: String) async -> [String: Any]? {
        guard let u = URL(string: s) else { return nil }
        var req = URLRequest(url: u); req.timeoutInterval = 12
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (d, _) = try? await URLSession.shared.data(for: req) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }

    static func postales() async -> [Postal] {
        guard let u = URL(string: site + "/postal.json") else { return [] }
        var req = URLRequest(url: u); req.timeoutInterval = 10
        guard let (d, _) = try? await URLSession.shared.data(for: req),
              let f = try? JSONDecoder().decode(PostalFile.self, from: d) else { return [] }
        return f.postales
    }

    /// La postal de hoy: días pares Miami, impares los Cayos; dentro de cada zona, en orden.
    static func pick(_ all: [Postal], _ d: Date = Date()) -> Postal? {
        guard !all.isEmpty else { return nil }
        var cal = Calendar(identifier: .gregorian); cal.timeZone = ny
        let day = cal.ordinality(of: .day, in: .era, for: d) ?? 0
        let zone = day % 2 == 0 ? "miami" : "keys"
        let list = all.filter { $0.scope == zone }
        let pool = list.isEmpty ? all : list
        return pool[(day / 2) % pool.count]
    }

    /// Descarga la foto y la recorta a la forma del widget alrededor del punto de interés,
    /// ya reducida (WidgetKit rechaza imágenes grandes).
    static func photo(_ p: Postal, aspect: CGFloat) async -> UIImage? {
        let ok = p.foto.range(of: #"^[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)$"#, options: .regularExpression) != nil
        guard ok, let u = URL(string: site + "/fotos/" + p.foto) else { return nil }
        var req = URLRequest(url: u); req.timeoutInterval = 15
        guard let (d, _) = try? await URLSession.shared.data(for: req), let src = UIImage(data: d),
              let cg = src.cgImage else { return nil }
        let w = CGFloat(cg.width), h = CGFloat(cg.height)
        var r: CGRect
        if w / h > aspect {
            let nw = h * aspect
            let x = min(max(CGFloat(p.fx ?? 0.5) * w - nw / 2, 0), w - nw)
            r = CGRect(x: x, y: 0, width: nw, height: h)
        } else {
            let nh = w / aspect
            let y = min(max(CGFloat(p.fy ?? 0.5) * h - nh / 2, 0), h - nh)
            r = CGRect(x: 0, y: y, width: w, height: nh)
        }
        guard let cut = cg.cropping(to: r.integral) else { return nil }
        let outW: CGFloat = aspect > 1.5 ? 760 : 480
        let size = CGSize(width: outW, height: (outW / aspect).rounded())
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1; fmt.opaque = true
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
            UIImage(cgImage: cut).draw(in: CGRect(origin: .zero, size: size))
        }
    }

    static func palm() async -> UIImage? {
        guard let u = URL(string: site + "/miami-magic-icon-180.png") else { return nil }
        var req = URLRequest(url: u); req.timeoutInterval = 10
        req.cachePolicy = .returnCacheDataElseLoad
        guard let (d, _) = try? await URLSession.shared.data(for: req), let i = UIImage(data: d) else { return nil }
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
        let s = CGSize(width: 96, height: 96)
        return UIGraphicsImageRenderer(size: s, format: fmt).image { _ in i.draw(in: CGRect(origin: .zero, size: s)) }
    }

    /// "2026-11-16T17:32" -> "5:32"
    static func clock(_ iso: String?) -> String? {
        guard let iso = iso, iso.count >= 16 else { return nil }
        let p = iso.suffix(5).split(separator: ":")
        guard p.count == 2, let h = Int(p[0]) else { return nil }
        return "\(h % 12 == 0 ? 12 : h % 12):\(p[1])"
    }

    static func load(family: WidgetFamily) async -> PostalEntry {
        let all = await postales()
        let p = pick(all)
        // el clima va con la zona de la postal: Miami o Key West
        let keys = p?.scope == "keys"
        let lat = keys ? "24.56" : "25.77", lon = keys ? "-81.78" : "-80.19"
        async let fj = json("https://api.open-meteo.com/v1/forecast?latitude=\(lat)&longitude=\(lon)"
            + "&current=temperature_2m&daily=sunset&temperature_unit=fahrenheit"
            + "&timezone=America%2FNew_York&forecast_days=1")
        // punto en el agua frente a cada zona (en tierra la API no da temperatura del mar)
        let mlat = keys ? "24.50" : "25.77", mlon = keys ? "-81.80" : "-80.13"
        async let mj = json("https://marine-api.open-meteo.com/v1/marine?latitude=\(mlat)&longitude=\(mlon)"
            + "&current=sea_surface_temperature&timezone=America%2FNew_York")
        async let pm = palm()
        let aspect: CGFloat = family == .systemMedium ? 2.12 : 1.0
        var img: UIImage? = nil
        if let p = p { img = await photo(p, aspect: aspect) }
        let f = await fj, m = await mj

        var temp: Int? = nil, sunset: String? = nil, sea: Int? = nil
        if let c = f?["current"] as? [String: Any], let t = c["temperature_2m"] as? Double { temp = Int(t.rounded()) }
        if let d = f?["daily"] as? [String: Any] { sunset = clock((d["sunset"] as? [String])?.first) }
        if let c = m?["current"] as? [String: Any], let t = c["sea_surface_temperature"] as? Double { sea = Int((t * 9 / 5 + 32).rounded()) }   // llega en °C
        return PostalEntry(date: Date(), postal: p, image: img, palm: await pm,
                           tempF: temp, seaF: sea, sunset: sunset, isPlaceholder: false)
    }
}

// MARK: - Provider

struct PostalProvider: TimelineProvider {
    func placeholder(in context: Context) -> PostalEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (PostalEntry) -> Void) {
        if context.isPreview { completion(.placeholder); return }
        Task { completion(await PostalAPI.load(family: context.family)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PostalEntry>) -> Void) {
        Task {
            let entry = await PostalAPI.load(family: context.family)
            // sin foto (sin red): reintenta pronto; con foto: cada hora, y siempre al cambiar el día
            var cal = Calendar(identifier: .gregorian); cal.timeZone = PostalAPI.ny
            let soon = Date().addingTimeInterval(entry.image == nil ? 15 * 60 : 60 * 60)
            let midnight = cal.nextDate(after: Date(), matching: DateComponents(hour: 0, minute: 5),
                                        matchingPolicy: .nextTime) ?? soon
            completion(Timeline(entries: [entry], policy: .after(min(soon, midnight))))
        }
    }
}

// MARK: - Textos y colores

enum PT {
    static var es: Bool { Locale.current.language.languageCode?.identifier == "es" }
    static func eyebrow(_ p: Postal?) -> String {
        let keys = p?.scope == "keys"
        if es { return keys ? "HOY EN LOS CAYOS" : "HOY EN MIAMI" }
        return keys ? "TODAY IN THE KEYS" : "TODAY IN MIAMI"
    }
    static func name(_ p: Postal?) -> String { guard let p = p else { return "Miami Magic" }; return es ? (p.name_es ?? p.name) : p.name }
    static func line(_ p: Postal?) -> String? { guard let p = p else { return nil }; return es ? (p.line_es ?? p.line) : p.line }
    static var sunset: String { es ? "ATARDECER" : "SUNSET" }
    static var sea: String { es ? "EL MAR" : "THE SEA" }
}

extension Color {
    static let mmNavy  = Color(red: 0.055, green: 0.106, blue: 0.188)   // #0E1B30
    static let mmNavy2 = Color(red: 0.043, green: 0.082, blue: 0.149)
    static let mmGold  = Color(red: 1.00,  green: 0.820, blue: 0.400)   // #FFD166
    static let mmCoral = Color(red: 1.00,  green: 0.302, blue: 0.208)
}

// MARK: - Vistas

struct PostalBackground: View {
    let e: PostalEntry
    var body: some View {
        ZStack {
            if let img = e.image {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                LinearGradient(colors: [.mmNavy, .mmNavy2], startPoint: .topLeading, endPoint: .bottomTrailing)
                RadialGradient(colors: [Color.mmGold.opacity(0.22), .clear], center: .topTrailing, startRadius: 0, endRadius: 160)
            }
            // velo para que el texto se lea siempre sobre la foto
            LinearGradient(stops: [
                .init(color: Color.mmNavy.opacity(0.46), location: 0),
                .init(color: Color.mmNavy.opacity(0.0),  location: 0.34),
                .init(color: Color.mmNavy.opacity(0.14), location: 0.52),
                .init(color: Color.mmNavy.opacity(0.88), location: 1)
            ], startPoint: .top, endPoint: .bottom)
        }
    }
}

struct PostalTop: View {
    let e: PostalEntry
    var body: some View {
        HStack(alignment: .top) {
            if let p = e.palm {
                Image(uiImage: p).resizable().frame(width: 26, height: 26)
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    .shadow(color: .black.opacity(0.3), radius: 3, y: 1)
            } else {
                Text("Miami Magic").font(.system(size: 12, weight: .bold, design: .serif)).foregroundColor(.white)
            }
            Spacer(minLength: 0)
            if let t = e.tempF {
                HStack(alignment: .top, spacing: 1) {
                    Text("\(t)").font(.system(size: 27, weight: .bold, design: .serif)).foregroundColor(.white)
                    Text("\u{00B0}F").font(.system(size: 10, weight: .bold)).foregroundColor(.mmGold).padding(.top, 4)
                }
                .shadow(color: .black.opacity(0.45), radius: 5, y: 1)
            }
        }
    }
}

struct PostalTitle: View {
    let e: PostalEntry
    let size: CGFloat
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(PT.eyebrow(e.postal))
                .font(.system(size: 10, weight: .heavy)).tracking(1.9).foregroundColor(.mmGold)
                .lineLimit(1).minimumScaleFactor(0.8)
            Text(PT.name(e.postal))
                .font(.system(size: size, weight: .bold, design: .serif)).foregroundColor(.white)
                .lineLimit(2).minimumScaleFactor(0.72)
                .shadow(color: .black.opacity(0.5), radius: 5, y: 1)
            if let l = PT.line(e.postal) {
                Text(l).font(.system(size: 11.5, weight: .medium)).foregroundColor(.white.opacity(0.92))
                    .lineLimit(1).minimumScaleFactor(0.8).padding(.top, 1)
            }
        }
    }
}

struct PostalSmall: View {
    let e: PostalEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PostalTop(e: e)
            Spacer(minLength: 0)
            PostalTitle(e: e, size: 19)
        }
        .padding(15)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct PostalMedium: View {
    let e: PostalEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PostalTop(e: e)
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 12) {
                PostalTitle(e: e, size: 22)
                Spacer(minLength: 0)
                if let s = e.sunset { fact(s, PT.sunset) }
                if let s = e.seaF { fact("\(s)\u{00B0}", PT.sea) }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    func fact(_ v: String, _ l: String) -> some View {
        VStack(spacing: 1) {
            Text(v).font(.system(size: 16, weight: .bold, design: .serif)).foregroundColor(.mmGold)
            Text(l).font(.system(size: 8.5, weight: .heavy)).tracking(1.3).foregroundColor(.white.opacity(0.9))
        }
        .fixedSize()
    }
}

struct PostalWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: PostalEntry
    var link: URL? {
        guard let p = entry.postal else { return URL(string: "miamimagic://home") }
        var c = URLComponents(); c.scheme = "miamimagic"; c.host = "ficha"
        c.queryItems = [URLQueryItem(name: "mt", value: p.mt), URLQueryItem(name: "id", value: p.id)]
        return c.url
    }
    var body: some View {
        Group {
            switch family {
            case .systemMedium: PostalMedium(e: entry)
            default:            PostalSmall(e: entry)
            }
        }
        .containerBackground(for: .widget) { PostalBackground(e: entry) }
        .widgetURL(link)
    }
}

// MARK: - Widget

struct MiamiAhoraWidget: Widget {
    let kind = "MiamiAhoraWidget"     // mismo identificador: quien ya lo tiene puesto recibe el diseño nuevo
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PostalProvider()) { entry in
            PostalWidgetView(entry: entry)
        }
        .configurationDisplayName(PT.es ? "La postal del día" : "Postcard of the day")
        .description(PT.es
            ? "Cada día, un lugar de Miami o de los Cayos."
            : "Every day, a place in Miami or the Keys.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}

@main
struct MiamiAhoraWidgetBundle: WidgetBundle {
    var body: some Widget { MiamiAhoraWidget() }
}

#Preview(as: .systemMedium) {
    MiamiAhoraWidget()
} timeline: {
    PostalEntry.placeholder
}
