// A floating, translucent panel listing the sessions the beacon mod reports in
// ~/.claude/state/beacon/*.json. Build and install with ./install.sh.
import AppKit
import SwiftUI

struct Status: Decodable {
  let id: String
  let cwd: String
  let link: String
  let archived: Bool
  let title: String
  let state: String?
  let ended: Bool
  let updatedAt: Double
}

struct Row: Identifiable {
  let status: Status
  let file: URL
  var id: String { status.id }
}

let glyphs = ["needs-you": "❓", "error": "⚠️", "waiting": "⏳", "working": "🔵", "done": "✅"]
// Attention order: what needs the person first, finished work last.
let rank = ["needs-you": 0, "error": 1, "waiting": 2, "working": 3, "done": 4]
let liveHours = 24.0
let doneHours = 3.0

final class Model: ObservableObject {
  @Published var rows: [Row] = []
  @Published var now = Date()
  @AppStorage("showDone") var showDone = true { willSet { objectWillChange.send() } }
  @AppStorage("compact") var compact = false { willSet { objectWillChange.send() } }
  let dir = ProcessInfo.processInfo.environment["BEACON_STATE_DIR"].map { URL(fileURLWithPath: $0) }
    ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/state/beacon")

  func reload() {
    now = Date()
    let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
    let nowMs = now.timeIntervalSince1970 * 1000
    let found = files.filter { $0.pathExtension == "json" }.compactMap { file -> Row? in
      // A file caught mid-write fails to decode and is skipped until the next tick.
      guard let data = try? Data(contentsOf: file),
            let s = try? JSONDecoder().decode(Status.self, from: data),
            let state = s.state, !s.archived else { return nil }
      let ageHours = (nowMs - s.updatedAt) / 3_600_000
      if state == "done" { if !showDone || ageHours > doneHours { return nil } }
      else if ageHours > liveHours { return nil }
      return Row(status: s, file: file)
    }
    // One app session can own two files (an older mod build named them by app id); the newest wins.
    rows = Dictionary(grouping: found, by: \.status.id).values.compactMap { $0.max { $0.status.updatedAt < $1.status.updatedAt } }
    .sorted {
      let a = rank[$0.status.state ?? ""] ?? 9, b = rank[$1.status.state ?? ""] ?? 9
      return a != b ? a < b : $0.status.updatedAt > $1.status.updatedAt
    }
  }

  func clearFinished() {
    for row in rows where row.status.state == "done" { try? FileManager.default.removeItem(at: row.file) }
    reload()
  }
}

func age(_ ms: Double, _ now: Date) -> String {
  let s = max(0, Int(now.timeIntervalSince1970 - ms / 1000))
  if s < 60 { return "\(s)s" }
  if s < 3600 { return "\(s / 60)m" }
  return "\(s / 3600)h"
}

struct RowView: View {
  let row: Row
  let now: Date
  @State private var hover = false

  var body: some View {
    let s = row.status
    HStack(spacing: 8) {
      Text(glyphs[s.state ?? ""] ?? "·").frame(width: 18)
      VStack(alignment: .leading, spacing: 1) {
        Text(s.title).font(.system(size: 12, weight: s.state == "needs-you" ? .semibold : .regular))
          .lineLimit(1).truncationMode(.tail)
        Text(URL(fileURLWithPath: s.cwd).lastPathComponent).font(.system(size: 10)).foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer(minLength: 4)
      Text(age(s.updatedAt, now)).font(.system(size: 10).monospacedDigit()).foregroundStyle(.secondary)
    }
    .padding(.horizontal, 8).padding(.vertical, 4)
    .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(hover ? 0.1 : 0)))
    .contentShape(Rectangle())
    .onHover { hover = $0 }
    .onTapGesture { if let url = URL(string: s.link), !s.link.isEmpty { NSWorkspace.shared.open(url) } }
    .help(s.link.isEmpty ? "\(s.title) — terminal session" : "\(s.title) — click to open")
  }
}

struct PanelView: View {
  @ObservedObject var model: Model

  var counts: String {
    let order = ["needs-you", "error", "waiting", "working", "done"]
    let parts = order.compactMap { st -> String? in
      let n = model.rows.filter { $0.status.state == st }.count
      return n == 0 ? nil : "\(glyphs[st]!) \(n)"
    }
    return parts.isEmpty ? "no sessions" : parts.joined(separator: "  ")
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack {
        Text("Claude").font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary)
        Spacer()
        Text(counts).font(.system(size: 11))
      }
      .padding(.horizontal, 8).padding(.vertical, 4)
      .contentShape(Rectangle())
      .onTapGesture { model.compact.toggle() }
      .help("Click to collapse or expand; right-click for options")
      if !model.compact {
        ForEach(model.rows) { RowView(row: $0, now: model.now) }
      }
    }
    .padding(6)
    .frame(width: 300, alignment: .topLeading)
    .fixedSize(horizontal: false, vertical: true)
  }
}

final class Panel: NSPanel {
  override var canBecomeKey: Bool { false }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
  let model = Model()
  var panel: Panel!
  var hosting: NSHostingView<PanelView>!
  @AppStorage("opacity") var opacity = 0.85

  func applicationDidFinishLaunching(_ note: Notification) {
    panel = Panel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 60),
                  styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    panel.isMovableByWindowBackground = true
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = true
    panel.hidesOnDeactivate = false
    panel.alphaValue = opacity

    let blur = NSVisualEffectView()
    blur.material = .hudWindow
    blur.blendingMode = .behindWindow
    blur.state = .active
    blur.wantsLayer = true
    blur.layer?.cornerRadius = 12
    blur.layer?.masksToBounds = true
    hosting = NSHostingView(rootView: PanelView(model: model))
    hosting.translatesAutoresizingMaskIntoConstraints = false
    blur.addSubview(hosting)
    NSLayoutConstraint.activate([
      hosting.leadingAnchor.constraint(equalTo: blur.leadingAnchor),
      hosting.trailingAnchor.constraint(equalTo: blur.trailingAnchor),
      hosting.topAnchor.constraint(equalTo: blur.topAnchor),
      hosting.bottomAnchor.constraint(equalTo: blur.bottomAnchor),
    ])
    panel.contentView = blur

    let menu = NSMenu()
    menu.delegate = self
    blur.menu = menu

    if !panel.setFrameUsingName("BeaconWidget"), let screen = NSScreen.main {
      let f = screen.visibleFrame
      panel.setFrameTopLeftPoint(NSPoint(x: f.maxX - 320, y: f.maxY - 20))
    }
    panel.setFrameAutosaveName("BeaconWidget")
    tick()
    panel.orderFrontRegardless()
    Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    #if SNAPSHOT
    // `swiftc -D SNAPSHOT`: render the rows to BEACON_SNAPSHOT and exit, for checks without
    // screen-recording rights. The blur behind them does not render offscreen.
    NSApp.appearance = NSAppearance(named: .aqua)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [self] in
      if let rep = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds),
         let out = ProcessInfo.processInfo.environment["BEACON_SNAPSHOT"] {
        hosting.cacheDisplay(in: hosting.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: out))
      }
      NSApp.terminate(nil)
    }
    #endif
  }

  // The panel grows and shrinks with its rows, anchored at its top-left corner.
  func tick() {
    model.reload()
    DispatchQueue.main.async { [self] in
      let size = hosting.fittingSize
      guard abs(size.height - panel.frame.height) > 0.5 || abs(size.width - panel.frame.width) > 0.5 else { return }
      let top = NSPoint(x: panel.frame.minX, y: panel.frame.maxY)
      panel.setContentSize(size)
      panel.setFrameTopLeftPoint(top)
    }
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    let opacityMenu = NSMenu()
    for v in [1.0, 0.85, 0.7, 0.55, 0.4] {
      let item = NSMenuItem(title: "\(Int(v * 100))%", action: #selector(setOpacity(_:)), keyEquivalent: "")
      item.representedObject = v
      item.state = abs(v - opacity) < 0.01 ? .on : .off
      item.target = self
      opacityMenu.addItem(item)
    }
    let op = NSMenuItem(title: "Opacity", action: nil, keyEquivalent: "")
    op.submenu = opacityMenu
    menu.addItem(op)
    add(menu, model.showDone ? "Hide finished" : "Show finished", #selector(toggleDone))
    add(menu, model.compact ? "Expand" : "Collapse", #selector(toggleCompact))
    add(menu, "Clear finished", #selector(clearFinished))
    add(menu, "Open status folder", #selector(openFolder))
    menu.addItem(.separator())
    add(menu, "Quit", #selector(quit))
  }

  func add(_ menu: NSMenu, _ title: String, _ action: Selector) {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
    item.target = self
    menu.addItem(item)
  }

  @objc func setOpacity(_ item: NSMenuItem) {
    opacity = item.representedObject as? Double ?? 0.85
    panel.alphaValue = opacity
  }
  @objc func toggleDone() { model.showDone.toggle(); tick() }
  @objc func toggleCompact() { model.compact.toggle(); tick() }
  @objc func clearFinished() { model.clearFinished(); tick() }
  @objc func openFolder() { NSWorkspace.shared.open(model.dir) }
  @objc func quit() { NSApp.terminate(nil) }
}

@main
enum Main {
  static func main() {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
  }
}
