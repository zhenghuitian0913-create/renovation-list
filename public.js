(function () {
  "use strict";

  const app = document.getElementById("app");
  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxCaption = document.getElementById("lightboxCaption");
  const lightboxClose = document.getElementById("lightboxClose");

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `更新时间：${date.toLocaleString("zh-CN", { hour12: false })}`;
  }

  function cleanCellHtml(raw) {
    const html = String(raw || "").trim();
    if (!html || html === "&nbsp;") return "";
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll("a").forEach((link) => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
    template.content.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());
    template.content.querySelectorAll("*").forEach((node) => {
      for (const attribute of [...node.attributes]) {
        const name = attribute.name.toLowerCase();
        if (!["href", "class", "target", "rel"].includes(name)) node.removeAttribute(attribute.name);
        else if (name === "href" && /^\s*javascript:/i.test(attribute.value)) node.removeAttribute("href");
      }
      // Keep the original row-cell wrapper in control of line wrapping.
    });
    return template.innerHTML;
  }

  function renderHeader(title, subtitle, updatedAt) {
    document.title = title || "装修需求清单";
    document.getElementById("pageTitle").textContent = title || "装修需求清单";
    document.getElementById("pageSubtitle").textContent = subtitle || "";
    document.getElementById("updateTime").textContent = formatTime(updatedAt);
  }

  function createAssets(cell) {
    const assets = Array.isArray(cell.assets) ? cell.assets : [];
    if (!assets.length) return "";
    const wrap = document.createElement("div");
    wrap.className = "asset-list";
    assets.forEach((asset) => {
      const src = encodeURI(String(asset.src || ""));
      if (!src) return;
      if (asset.type === "video") {
        const video = document.createElement("video");
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.src = src;
        video.setAttribute("aria-label", asset.name || "参考视频");
        wrap.appendChild(video);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "media-button";
      button.setAttribute("aria-label", `放大查看 ${asset.name || "参考图"}`);
      const image = document.createElement("img");
      image.loading = "lazy";
      image.alt = asset.name || "参考图";
      image.src = src;
      button.appendChild(image);
      button.addEventListener("click", () => openLightbox(src, asset.name || ""));
      wrap.appendChild(button);
    });
    return wrap;
  }

  function createCell(cell) {
    const td = document.createElement("td");
    const html = cleanCellHtml(cell && cell.html);
    if (html) {
      const content = document.createElement("div");
      content.className = "cell-text";
      content.innerHTML = html;
      td.appendChild(content);
    }
    const assets = createAssets(cell || {});
    if (assets) td.appendChild(assets);
    if (!td.childNodes.length) {
      const blank = document.createElement("div");
      blank.className = "cell-text";
      blank.textContent = "—";
      blank.style.color = "#b9b3a8";
      td.appendChild(blank);
    }
    return td;
  }

  function renderContent(data) {
    app.replaceChildren();
    const sections = document.createElement("div");
    sections.className = "sections";

    (data.sections || []).forEach((section) => {
      const box = document.createElement("section");
      box.className = "section";
      const head = document.createElement("div");
      head.className = "section-head";
      const h2 = document.createElement("h2");
      h2.className = "section-title";
      h2.textContent = section.title || "";
      const count = document.createElement("span");
      count.className = "section-count";
      count.textContent = `${(section.rows || []).length} 项`;
      head.append(h2, count);

      const tableWrap = document.createElement("div");
      tableWrap.className = "table-wrap";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      const headers = Array.isArray(section.headers) ? section.headers : [];
      headers.forEach((label) => {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = String(label || "").trim() || "参考图 / 链接";
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      const tbody = document.createElement("tbody");
      (section.rows || []).forEach((row) => {
        const tr = document.createElement("tr");
        (row.cells || []).forEach((cell) => tr.appendChild(createCell(cell)));
        for (let index = (row.cells || []).length; index < headers.length; index += 1) {
          tr.appendChild(createCell({ html: "", assets: [] }));
        }
        tbody.appendChild(tr);
      });
      table.append(thead, tbody);
      tableWrap.appendChild(table);
      box.append(head, tableWrap);
      sections.appendChild(box);
    });

    app.appendChild(sections);
  }

  function openLightbox(src, caption) {
    lightboxImage.src = src;
    lightboxImage.alt = caption;
    lightboxCaption.textContent = caption;
    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
    lightboxClose.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove("open");
    lightboxImage.src = "";
    document.body.style.overflow = "";
  }

  async function loadPage() {
    try {
      const response = await fetch(`content.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      renderHeader(data.title, data.subtitle, data.updatedAt);
      renderContent(data);
    } catch (error) {
      console.error(error);
      app.innerHTML = '<div class="error-note">内容加载失败。请确认 content.json 和 assets 文件夹已经一起上传，并且公开链接直接指向站点根目录。</div>';
    }
  }

  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox || event.target === lightboxClose) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && lightbox.classList.contains("open")) closeLightbox();
  });

  loadPage();
})();
