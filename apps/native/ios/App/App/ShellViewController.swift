import UIKit
import Capacitor

/// The store app's web view controller: Capacitor's own, plus the fold of a
/// foldable iPhone (iPhone Duo) for the page.
///
/// WKWebView gives a page no fold (Safari's Viewport Segments is a feature
/// flag in Safari and can't be turned on in a web view), so the page is told:
/// the `Fold` plugin below sends the "division" reserved regions UIKit reports
/// (`UIView.reservedRegions(kind: .division)`, iOS 27.1) and the page turns
/// them into the same CSS it uses in a browser (apps/app/src/lib/native/fold.ts).
///
/// The fold code needs the iOS 27.1 SDK. It compiles only when the build says
/// so (`SWIFT_ACTIVE_COMPILATION_CONDITIONS=FOLD_API`, set by the iOS workflows
/// when the Xcode in use has that SDK), so a build with an older Xcode is
/// unchanged. Without it the page gets no `Fold` plugin and ignores the fold.
class ShellViewController: CAPBridgeViewController {
    #if FOLD_API
    private let fold = FoldPlugin()

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(fold)

        // A view over the whole page that reads the regions. UIKit runs its
        // updateConstraints() again when a region it read there changes (the
        // fold becoming active or not), and its frames are in the page's own
        // coordinates, which are CSS pixels.
        let probe = FoldProbeView()
        probe.plugin = fold
        probe.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(probe)
        NSLayoutConstraint.activate([
            probe.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            probe.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            probe.topAnchor.constraint(equalTo: view.topAnchor),
            probe.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }
    #endif
}

#if FOLD_API
@objc(FoldPlugin)
public final class FoldPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FoldPlugin"
    public let jsName = "Fold"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
    ]

    /// `{ divisions: [{ x, y, width, height }], width, height }`, in points (CSS pixels).
    private var report: [String: Any] = ["divisions": [[String: Double]](), "width": 0.0, "height": 0.0]

    @objc func get(_ call: CAPPluginCall) {
        call.resolve(report)
    }

    func publish(_ next: [String: Any]) {
        guard !NSDictionary(dictionary: next).isEqual(to: report) else { return }
        report = next
        notifyListeners("foldChange", data: next)
    }
}

final class FoldProbeView: UIView {
    weak var plugin: FoldPlugin?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    // Reading the regions here is what makes UIKit call this again when they change.
    override func updateConstraints() {
        publish()
        super.updateConstraints()
    }

    // A resize (Split View, rotating) moves the regions' frames too.
    override func layoutSubviews() {
        super.layoutSubviews()
        publish()
    }

    private func publish() {
        // Only the active divisions: the fold while the phone is partly open or closed.
        let divisions = reservedRegions(kind: .division).map { region in
            ["x": Double(region.frame.minX), "y": Double(region.frame.minY), "width": Double(region.frame.width), "height": Double(region.frame.height)]
        }
        plugin?.publish(["divisions": divisions, "width": Double(bounds.width), "height": Double(bounds.height)])
    }
}
#endif
