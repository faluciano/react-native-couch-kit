// Renders the ```mermaid fenced code blocks that TypeDoc emits as
// `<pre><code class="mermaid">…</code></pre>` into actual diagrams.
// TypeDoc does not bundle mermaid, so we load it on demand from a CDN.
(function () {
  function collect() {
    return Array.from(document.querySelectorAll("pre > code.mermaid"));
  }

  function prefersDark() {
    return (
      document.documentElement.dataset.theme === "dark" ||
      (document.documentElement.dataset.theme !== "light" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    );
  }

  async function render() {
    const blocks = collect();
    if (blocks.length === 0) return;

    const nodes = blocks.map((code) => {
      const pre = code.parentElement;
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      pre.replaceWith(div);
      return div;
    });

    const { default: mermaid } = await import(
      "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"
    );
    mermaid.initialize({
      startOnLoad: false,
      theme: prefersDark() ? "dark" : "default",
    });
    await mermaid.run({ nodes });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
