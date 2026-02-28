/**
 * Footer Component - Minimal attribution footer
 *
 * Provides credit to 3D model creators as required by CC BY license
 * Styled to be unobtrusive and minimal
 */

export default function Footer() {
  return (
    <footer className="bg-black/20 backdrop-blur-sm border-t border-white/5">
      <div className="max-w-7xl mx-auto px-4 py-2">
        <div className="flex items-center justify-center gap-4 text-[10px] text-gray-500">
          <span className="opacity-50">3D Models:</span>
          <a
            href="https://sketchfab.com/omabuarts"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-40 hover:opacity-70 transition-opacity"
          >
            omabuarts
          </a>
          <span className="opacity-30">•</span>
          <a
            href="https://sketchfab.com/GreenG"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-40 hover:opacity-70 transition-opacity"
          >
            GreenG
          </a>
          <span className="opacity-30">•</span>
          <a
            href="https://sketchfab.com/SDC.performance"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-40 hover:opacity-70 transition-opacity"
          >
            SDC
          </a>
          <span className="opacity-30">•</span>
          <a
            href="https://sketchfab.com/ken_art30"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-40 hover:opacity-70 transition-opacity"
          >
            TeKen
          </a>
          <span className="opacity-30">•</span>
          <a
            href="https://sketchfab.com/l0wpoly"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-40 hover:opacity-70 transition-opacity"
          >
            l0wpoly
          </a>
        </div>
      </div>
    </footer>
  );
}
