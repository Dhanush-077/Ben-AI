// Renders the search_images() results the backend returns alongside a reply
// as a horizontal strip of clickable thumbnails. Each tile opens the image's
// source page in a new tab (never navigates the SPA away from the chat).
export default function ImageStrip({ images }) {
  if (!images || images.length === 0) return null;
  return (
    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
      {images.slice(0, 6).map((img, i) => (
        <a
          key={i}
          href={img.context_url || img.image_url}
          target="_blank"
          rel="noopener noreferrer"
          title={img.title || "Image"}
          className="group relative block w-28 h-28 shrink-0 rounded-lg overflow-hidden border border-black/10 dark:border-white/20 bg-stone-200 dark:bg-stone-700"
        >
          <img
            src={img.image_url}
            alt={img.title || "Search result image"}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-150 group-hover:scale-105"
          />
          <span className="absolute inset-x-0 bottom-0 bg-black/55 text-white text-[11px] leading-tight px-1.5 py-1 line-clamp-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {img.title}
          </span>
        </a>
      ))}
    </div>
  );
}