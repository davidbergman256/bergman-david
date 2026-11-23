# bergmandavid.com

Static personal site for David Bergman, deployed with GitHub Pages from the root of `main`.

Everything is drawn with characters. Plain HTML, CSS, and ES modules. GitHub Pages runs Jekyll on each push, but only to turn blog posts into pages: files without front matter are copied as they are.

- `/` is the pond: koi drawn in ASCII over a small wave simulation. Click (or press Enter) to feed them, hover one to see its variety, let the cursor rest and they come over, or type to write on the water. `assets/js/pond.js`.
- `/projects/` draws each project as a plate in a drawing set. `assets/js/plates.js`.
- `/photos/` shows photos as ASCII that develop into the real image on hover or tap. `assets/js/photos.js`.
- `/blog/` lists the posts in `_posts/`, with a stone at the waterline below them (`assets/js/stone.js`). With no posts, the stone fills the page.
- `assets/js/common.js` holds the theme toggle, the typed couplets, and `AsciiCanvas`, the glyph-atlas renderer the canvases share.

## Writing a post

Add a markdown file to `_posts/` named with its date, like `_posts/2026-11-23-on-koi.md`, and push. About a minute later it is live at `/blog/on-koi/`. Its first `# Heading` is the title; no other setup is needed. Images go in `assets/blog/`. Anything in `_drafts/` is never published; `_drafts/how-to-write-a-post.md` shows every formatting option. Posts also feed `/blog/feed.xml` and the sitemap.

To preview the blog locally you need Jekyll (`gem install github-pages`, then `jekyll serve`); the plain Python server below shows every page except the blog.

## Other upkeep

To change the photo of the week, replace `assets/photo-of-the-week.jpg` and update its alt text in `photos/index.html`. The resume is `assets/David_Bergman_Resume.pdf`.

CSS and JS are cache-busted with a `?v=N` query, in the HTML files and in each page script's `common.js` import. When you change them, bump every `?v=N` to the same new number.

Run locally with `python3 -m http.server 8000` and open http://localhost:8000. Add `?debug` to a page's URL to expose its scene on `window` for poking at from the console.
