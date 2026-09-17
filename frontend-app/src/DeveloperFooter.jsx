import { useState } from "react";
import { Mail, Phone, FileText, X, User } from "lucide-react";

// lucide-react removed brand icons (Github/Linkedin), so render them as
// inline SVGs instead (standard GitHub/LinkedIn marks, inheriting text color).
function GithubIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function LinkedinIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

// Paste your Google Drive share link here (Share > Anyone with the link > Viewer).
// Opens instantly in a new tab as a preview — no download wait for the viewer.
const RESUME_LINK = "https://drive.google.com/file/d/1SxAgTUVVsXIlN8yxjZhd9VMzvf7uiVSB/view?usp=sharing";

const DEVELOPER = {
  name: "Janakisetty Dhanush Babu",
  photo: "/developer-photo.jpeg",
  role: "B.Tech CSE, 3rd Year — PBR Visvodaya Institute of Technology and Science",
  location: "Kavali, Nellore District, Andhra Pradesh",
  email: "janakisettydhanushbabu333@gmail.com",
  phone: "+91 9059672119",
  github: "",
  linkedin: "https://linkedin.com/in/dhanushbabujanakisetty",
  projects: [
    "Virtual Keyboard & Air Mouse System — Python, OpenCV, MediaPipe",
    "Tropical Cloud Cluster Detection — Deep learning on satellite imagery",
    "Gesture Control Presenter — CV-based Google Slides control",
  ],
};

export default function DeveloperFooter() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Slim footer bar */}
      <footer className="w-full border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 px-4 py-2.5 flex items-center justify-between text-sm text-stone-500 dark:text-stone-400">
        <div className="flex items-center gap-2">
          <img
            src={DEVELOPER.photo}
            alt={DEVELOPER.name}
            className="w-6 h-6 rounded-full object-cover"
          />
          <span>Built by {DEVELOPER.name}</span>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white font-medium transition-colors"
        >
          <User size={14} />
          About the developer
        </button>
      </footer>

      {/* About modal */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-stone-900 rounded-xl max-w-sm w-full p-6 relative shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-200"
              aria-label="Close"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3 mb-2">
              <img
                src={DEVELOPER.photo}
                alt={DEVELOPER.name}
                className="w-14 h-14 rounded-full object-cover"
              />
              <div>
                <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{DEVELOPER.name}</h2>
                <p className="text-sm text-stone-500 dark:text-stone-400">{DEVELOPER.role}</p>
              </div>
            </div>
            <p className="text-sm text-stone-500 dark:text-stone-400">{DEVELOPER.location}</p>

            <div className="mt-4 space-y-1.5">
              {DEVELOPER.projects.map((p) => (
                <p key={p} className="text-sm text-stone-600 dark:text-stone-300 leading-snug">
                  • {p}
                </p>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-3 text-sm">
              <a
                href={`mailto:${DEVELOPER.email}`}
                className="flex items-center gap-1.5 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
              >
                <Mail size={14} /> Email
              </a>
              <a
                href={`tel:${DEVELOPER.phone}`}
                className="flex items-center gap-1.5 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
              >
                <Phone size={14} /> Call
              </a>
              <a
                href={DEVELOPER.github}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
              >
                <GithubIcon /> GitHub
              </a>
              <a
                href={DEVELOPER.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
              >
                <LinkedinIcon /> LinkedIn
              </a>
            </div>

            <a
              href={RESUME_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 flex items-center justify-center gap-2 w-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-medium py-2.5 rounded-lg hover:bg-stone-800 dark:hover:bg-stone-300 transition-colors"
            >
              <FileText size={16} />
              View Resume
            </a>
          </div>
        </div>
      )}
    </>
  );
}
