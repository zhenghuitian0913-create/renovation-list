(function () {
  "use strict";

  const STORAGE_KEY = "renovation-admin-config";
  const elements = {
    owner: document.getElementById("owner"),
    repo: document.getElementById("repo"),
    branch: document.getElementById("branch"),
    directory: document.getElementById("directory"),
    token: document.getElementById("token"),
    loadButton: document.getElementById("loadButton"),
    localButton: document.getElementById("localButton"),
    saveButton: document.getElementById("saveButton"),
    bottomSaveButton: document.getElementById("bottomSaveButton"),
    resetButton: document.getElementById("resetButton"),
    status: document.getElementById("status"),
    progress: document.getElementById("progress"),
    progressBar: document.getElementById("progressBar"),
    editor: document.getElementById("editor"),
    title: document.getElementById("title"),
    subtitle: document.getElementById("subtitle"),
    sections: document.getElementById("sections"),
    dirtyNote: document.getElementById("dirtyNote"),
    fileInput: document.getElementById("fileInput")
  };

  let content = null;
  let savedContent = null;
  let contentSha = "";
  let dirty = false;
  let uploadTarget = null;
  const pendingFiles = new Map();

  const defaultConfig = {
    owner: "zhenghuitian0913-create",
    repo: "renovation-list",
    branch: "main",
    directory: ""
  };
  elements.owner.value = localStorage.getItem(`${STORAGE_KEY}:owner`) || defaultConfig.owner;
  elements.repo.value = localStorage.getItem(`${STORAGE_KEY}:repo`) || defaultConfig.repo;
  elements.branch.value = localStorage.getItem(`${STORAGE_KEY}:branch`) || defaultConfig.branch;
  elements.directory.value = localStorage.getItem(`${STORAGE_KEY}:directory`) || defaultConfig.directory;
  elements.token.value = localStorage.getItem(`${STORAGE_KEY}:token`) || "";

  function setStatus(message, type = "info") {
    elements.status.className = `status ${type}`;
    elements.status.textContent = message;
  }

  function setProgress(show, percent = 0) {
    elements.progress.classList.toggle("on", show);
    elements.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function saveConfig() {
    localStorage.setItem(`${STORAGE_KEY}:owner`, elements.owner.value.trim());
    localStorage.setItem(`${STORAGE_KEY}:repo`, elements.repo.value.trim());
    localStorage.setItem(`${STORAGE_KEY}:branch`, elements.branch.value.trim() || "main");
    localStorage.setItem(`${STORAGE_KEY}:directory`, elements.directory.value.trim());
    localStorage.setItem(`${STORAGE_KEY}:token`, elements.token.value.trim());
  }

  function contentPath() {
    const dir = elements.directory.value.trim().replace(/^\/+|\/+$/g, "");
    return dir ? `${dir}/content.json` : "content.json";
  }

  function apiHeaders() {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (elements.token.value.trim()) headers.Authorization = `Bearer ${elements.token.value.trim()}`;
    return headers;
  }

  async function request(url, options = {}) {
    const target = /^https?:/i.test(url) ? url : `https://api.github.com${url}`;
    const response = await fetch(target, { ...options, headers: { ...apiHeaders(), ...(options.headers || {}) } });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = { message: text }; }
    if (!response.ok) {
      const detail = payload && payload.message ? payload.message : `${response.status} ${response.statusText}`;
      throw new Error(detail);
    }
    return payload;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  }

  async function fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return bytesToBase64(bytes);
  }

  function decodeBase64(value) {
    const bytes = Uint8Array.from(atob(value.replace(/\s/g, "")), (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function normalizeContent(input) {
    if (!input || !Array.isArray(input.sections)) throw new Error("内容格式不正确：缺少 sections");
    const result = JSON.parse(JSON.stringify(input));
    result.version = result.version || 1;
    result.sections.forEach((section, sectionIndex) => {
      section.id = section.id || `section-${sectionIndex + 1}`;
      section.title = section.title || "";
      section.headers = Array.isArray(section.headers) ? section.headers : [];
      section.rows = Array.isArray(section.rows) ? section.rows : [];
      section.rows.forEach((row, rowIndex) => {
        row.id = row.id || `row-${sectionIndex + 1}-${rowIndex + 1}`;
        row.cells = Array.isArray(row.cells) ? row.cells : [];
        row.cells.forEach((cell, cellIndex) => {
          cell.id = cell.id || `cell-${sectionIndex + 1}-${rowIndex + 1}-${cellIndex + 1}`;
          if (typeof cell.html !== "string") cell.html = "";
          if (cell.html.trim() === "&nbsp;") cell.html = "";
          if (!Array.isArray(cell.assets)) cell.assets = [];
          cell.assets.forEach((asset) => {
            asset.id = asset.id || `asset-${Math.random().toString(36).slice(2, 10)}`;
            asset.src = String(asset.src || "");
            asset.name = String(asset.name || "");
            asset.type = asset.type || "image";
          });
        });
      });
    });
    return result;
  }

  function markDirty(state = true) {
    dirty = state;
    elements.saveButton.disabled = false;
    elements.bottomSaveButton.disabled = false;
    elements.dirtyNote.textContent = state ? "有未保存的修改；点击“保存并发布”后才会更新公开页。" : "已保存，和线上内容一致。";
  }

  function previewSource(asset) {
    return pendingFiles.has(asset.src) ? pendingFiles.get(asset.src).objectUrl : encodeURI(asset.src || "");
  }

  function setEditorValues() {
    elements.title.value = content.title || "";
    elements.subtitle.value = content.subtitle || "";
    renderSections();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function decodeCellHtml(raw) {
    const html = String(raw || "").trim();
    if (!html || html === "&nbsp;") return "";
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());

    const blockTags = ["DIV", "P", "LI", "UL", "OL", "SECTION", "ARTICLE", "H1", "H2", "H3", "H4", "H5", "H6"];
    function walk(node) {
      let text = "";
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          text += child.nodeValue.replace(/\u00a0/g, " ");
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (child.tagName === "BR") {
          text += "\n";
          continue;
        }
        if (child.tagName === "A") {
          const href = child.getAttribute("href") || "";
          const label = child.textContent.replace(/\s+/g, " ").trim();
          const same = label.replace(/\/$/, "") === href.replace(/\/$/, "");
          text += same ? href : `${label} (${href})`;
          continue;
        }
        if (blockTags.includes(child.tagName) && text && !text.endsWith("\n")) text += "\n";
        text += walk(child);
        if (blockTags.includes(child.tagName) && !text.endsWith("\n")) text += "\n";
      }
      return text;
    }

    return walk(template.content).replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function createLink(label, href) {
    return `<a href="${escapeHtml(encodeURI(href))}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || href)}</a>`;
  }

  function encodeTextLine(line) {
    const text = String(line || "").trim();
    if (!text) return "";
    const labelled = text.match(/^(.+?)\s*[（(]\s*(https?:\/\/[^\s<>]+?)\s*[)）]\s*$/u);
    if (labelled) return createLink(labelled[1], labelled[2]);

    let result = "";
    let lastIndex = 0;
    for (const match of text.matchAll(/https?:\/\/[^\s<>]+/gu)) {
      result += escapeHtml(text.slice(lastIndex, match.index));
      result += createLink(match[0], match[0]);
      lastIndex = match.index + match[0].length;
    }
    result += escapeHtml(text.slice(lastIndex));
    return result;
  }

  function encodeCellText(raw) {
    const text = String(raw || "").replace(/\r\n?/g, "\n");
    if (!text.trim()) return "&nbsp;";
    const lines = text.split("\n").map((line) => encodeTextLine(line));
    if (!lines.some((line) => line.trim())) return "&nbsp;";
    return `<div class="cell-text">${lines.join("<br>")}</div>`;
  }

  function getSectionHeaders(section) {
    const headers = Array.isArray(section.headers) ? section.headers : [];
    return headers.length ? headers : ["内容", "参考图 / 链接"];
  }

  function insertRow(section, afterIndex = section.rows.length - 1) {
    const headers = getSectionHeaders(section);
    section.rows.splice(afterIndex + 1, 0, {
      id: `row-${Date.now()}`,
      cells: Array.from({ length: headers.length }, (_, index) => ({
        id: `cell-${Date.now()}-${index}`,
        html: "&nbsp;",
        assets: []
      }))
    });
    markDirty();
    renderSections();
  }

  function renderSections() {
    elements.sections.replaceChildren();
    content.sections.forEach((section, sectionIndex) => {
      const wrapper = document.createElement("div");
      wrapper.className = "section";
      const card = document.createElement("div");
      card.className = "card section-box";

      const sectionHead = document.createElement("div");
      sectionHead.className = "section-head";
      const sectionTitle = document.createElement("input");
      sectionTitle.value = section.title || "";
      sectionTitle.addEventListener("input", () => {
        section.title = sectionTitle.value;
        markDirty();
      });
      const deleteSection = document.createElement("button");
      deleteSection.type = "button";
      deleteSection.className = "mini danger";
      deleteSection.textContent = "删除本节";
      deleteSection.addEventListener("click", () => {
        if (!window.confirm(`确定删除“${section.title || "这一节"}”整张表吗？里面的文字和参考图都会删除。`)) return;
        content.sections.splice(sectionIndex, 1);
        markDirty();
        renderSections();
      });
      sectionHead.append(sectionTitle, deleteSection);

      const headersEditor = document.createElement("details");
      headersEditor.className = "headers-editor";
      const summary = document.createElement("summary");
      summary.textContent = "修改表头 / 增删列";
      const headersBox = document.createElement("div");
      headersBox.className = "form-grid";
      const headers = getSectionHeaders(section);
      headers.forEach((header, headerIndex) => {
        const field = document.createElement("div");
        field.className = "field";
        const label = document.createElement("label");
        label.textContent = `第 ${headerIndex + 1} 列`;
        const input = document.createElement("input");
        input.value = header || "";
        input.addEventListener("input", () => {
          section.headers[headerIndex] = input.value;
          markDirty();
        });
        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.marginTop = "6px";
        const removeHeader = document.createElement("button");
        removeHeader.type = "button";
        removeHeader.className = "mini danger";
        removeHeader.textContent = "删除列";
        removeHeader.disabled = headers.length <= 1;
        removeHeader.addEventListener("click", () => {
          if (!window.confirm(`确定删除第 ${headerIndex + 1} 列吗？这一列里的文字和参考图也会删除。`)) return;
          section.headers.splice(headerIndex, 1);
          section.rows.forEach((row) => row.cells.splice(headerIndex, 1));
          markDirty();
          renderSections();
        });
        actions.appendChild(removeHeader);
        field.append(label, input, actions);
        headersBox.appendChild(field);
      });
      const addHeaderField = document.createElement("div");
      const addHeaderButton = document.createElement("button");
      addHeaderButton.type = "button";
      addHeaderButton.className = "mini";
      addHeaderButton.textContent = "＋ 新增一列";
      addHeaderButton.addEventListener("click", () => {
        section.headers.push("");
        section.rows.forEach((row) => row.cells.push({ id: `cell-${Date.now()}`, html: "&nbsp;", assets: [] }));
        markDirty();
        renderSections();
      });
      addHeaderField.appendChild(addHeaderButton);
      headersBox.appendChild(addHeaderField);
      headersEditor.append(summary, headersBox);

      card.append(sectionHead, headersEditor, createSectionTable(section, sectionIndex));

      const addRowButton = document.createElement("button");
      addRowButton.type = "button";
      addRowButton.className = "add-row";
      addRowButton.textContent = "在这一节新增一行";
      addRowButton.addEventListener("click", () => insertRow(section));
      card.appendChild(addRowButton);
      wrapper.appendChild(card);
      elements.sections.appendChild(wrapper);
    });

    const addSection = document.createElement("button");
    addSection.type = "button";
    addSection.className = "add-row";
    addSection.textContent = "＋ 新增一节";
    addSection.addEventListener("click", () => {
      content.sections.push({
        id: `section-${Date.now()}`,
        title: "新的一节",
        headers: ["板块", "空间/项目", "具体需求描述", "参考图", "备注 / 待确认"],
        rows: [{
          id: `row-${Date.now()}`,
          cells: [
            { id: `cell-${Date.now()}-1`, html: "&nbsp;", assets: [] },
            { id: `cell-${Date.now()}-2`, html: "&nbsp;", assets: [] },
            { id: `cell-${Date.now()}-3`, html: "&nbsp;", assets: [] },
            { id: `cell-${Date.now()}-4`, html: "&nbsp;", assets: [] },
            { id: `cell-${Date.now()}-5`, html: "&nbsp;", assets: [] }
          ]
        }]
      });
      markDirty();
      renderSections();
    });
    elements.sections.appendChild(addSection);
  }

  function createSectionTable(section, sectionIndex) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const table = document.createElement("table");
    table.className = "admin-table";
    const headers = getSectionHeaders(section);
    const colgroup = document.createElement("colgroup");
    const opCol = document.createElement("col");
    opCol.className = "col-op";
    colgroup.appendChild(opCol);
    headers.forEach(() => colgroup.appendChild(document.createElement("col")));
    table.appendChild(colgroup);

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const opHead = document.createElement("th");
    opHead.textContent = "行操作";
    headRow.appendChild(opHead);
    headers.forEach((header, index) => {
      const th = document.createElement("th");
      th.textContent = header || `第 ${index + 1} 列`;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    section.rows.forEach((row, rowIndex) => {
      tbody.appendChild(createTableRow(section, row, sectionIndex, rowIndex, headers));
    });
    if (!section.rows.length) {
      const emptyRow = document.createElement("tr");
      const emptyCell = document.createElement("td");
      emptyCell.colSpan = headers.length + 1;
      emptyCell.textContent = "这一节还没有内容，点下方“新增一行”。";
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    }
    table.append(thead, tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function createTableRow(section, row, sectionIndex, rowIndex, headers) {
    const tr = document.createElement("tr");
    const op = document.createElement("td");
    op.className = "op-cell";
    const label = document.createElement("span");
    label.className = "op-label";
    label.textContent = `第 ${rowIndex + 1} 行`;
    const buttons = document.createElement("div");
    buttons.className = "op-btns";

    const up = document.createElement("button");
    up.type = "button"; up.className = "mini"; up.textContent = "上移";
    up.disabled = rowIndex === 0;
    up.addEventListener("click", () => {
      section.rows.splice(rowIndex - 1, 0, section.rows.splice(rowIndex, 1)[0]);
      markDirty(); renderSections();
    });
    const down = document.createElement("button");
    down.type = "button"; down.className = "mini"; down.textContent = "下移";
    down.disabled = rowIndex === section.rows.length - 1;
    down.addEventListener("click", () => {
      section.rows.splice(rowIndex + 1, 0, section.rows.splice(rowIndex, 1)[0]);
      markDirty(); renderSections();
    });
    const insert = document.createElement("button");
    insert.type = "button"; insert.className = "mini"; insert.textContent = "插入行";
    insert.addEventListener("click", () => insertRow(section, rowIndex));
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "mini danger"; remove.textContent = "删除";
    remove.addEventListener("click", () => {
      if (!window.confirm("确定删除这一行吗？媒体引用也会一起删除。")) return;
      section.rows.splice(rowIndex, 1);
      markDirty(); renderSections();
    });
    buttons.append(up, down, insert, remove);
    op.append(label, buttons);
    tr.appendChild(op);

    headers.forEach((_, cellIndex) => {
      if (!row.cells[cellIndex]) {
        row.cells[cellIndex] = { id: `cell-${Date.now()}-${cellIndex}`, html: "&nbsp;", assets: [] };
      }
      tr.appendChild(createTableCell(section, row, sectionIndex, rowIndex, cellIndex));
    });
    return tr;
  }

  function createTableCell(section, row, sectionIndex, rowIndex, cellIndex) {
    const cell = row.cells[cellIndex] || { html: "&nbsp;", assets: [] };
    const td = document.createElement("td");
    const textarea = document.createElement("textarea");
    textarea.className = "cell-input";
    textarea.value = decodeCellHtml(cell.html);
    textarea.placeholder = "直接输入文字；粘贴链接会自动变成可点击链接。";
    textarea.addEventListener("input", () => {
      cell.html = encodeCellText(textarea.value);
      markDirty();
    });
    td.appendChild(textarea);

    const media = document.createElement("div");
    media.className = "cell-media";
    (cell.assets || []).forEach((asset, assetIndex) => {
      const tile = document.createElement("div");
      tile.className = "thumb";
      if (pendingFiles.has(asset.src)) tile.classList.add("pending");
      if (asset.type === "video") {
        const video = document.createElement("video");
        video.controls = true; video.preload = "metadata"; video.src = previewSource(asset);
        video.setAttribute("aria-label", asset.name || "参考视频");
        tile.appendChild(video);
      } else {
        const image = document.createElement("img");
        image.loading = "lazy"; image.alt = asset.name || "参考图"; image.src = previewSource(asset);
        tile.appendChild(image);
      }
      const actions = document.createElement("div");
      actions.className = "tile-actions";
      const replace = document.createElement("button");
      replace.type = "button"; replace.className = "tile-btn"; replace.textContent = "换";
      replace.addEventListener("click", () => {
        uploadTarget = { mode: "replace", sectionIndex, rowIndex, cellIndex, assetIndex };
        elements.fileInput.value = "";
        elements.fileInput.click();
      });
      const removeAsset = document.createElement("button");
      removeAsset.type = "button"; removeAsset.className = "tile-btn danger"; removeAsset.textContent = "×";
      removeAsset.addEventListener("click", () => {
        cell.assets.splice(assetIndex, 1);
        markDirty(); renderSections();
      });
      actions.append(replace, removeAsset);
      tile.appendChild(actions);
      media.appendChild(tile);
    });

      const addMedia = document.createElement("button");
      addMedia.type = "button"; addMedia.className = "add-tile"; addMedia.textContent = "＋ 图片/视频";
      addMedia.addEventListener("click", () => {
        uploadTarget = { mode: "add", sectionIndex, rowIndex, cellIndex };
        elements.fileInput.value = "";
        elements.fileInput.click();
      });
      media.appendChild(addMedia);
      td.appendChild(media);
    return td;
  }

  function safeFilename(name) {
    const extension = (name.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
    const base = String(name || "media").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `${base || "media"}${extension}`;
  }

  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files && elements.fileInput.files[0];
    if (!file || !uploadTarget) return;
    const cell = content.sections[uploadTarget.sectionIndex].rows[uploadTarget.rowIndex].cells[uploadTarget.cellIndex];
    const type = file.type.startsWith("video/") ? "video" : "image";
    const path = `assets/${Date.now()}-${safeFilename(file.name)}`;
    const objectUrl = URL.createObjectURL(file);

    if (uploadTarget.mode === "replace") {
      const oldPath = cell.assets[uploadTarget.assetIndex].src;
      if (pendingFiles.has(oldPath) && pendingFiles.get(oldPath).objectUrl) URL.revokeObjectURL(pendingFiles.get(oldPath).objectUrl);
      pendingFiles.delete(oldPath);
      const asset = cell.assets[uploadTarget.assetIndex];
      asset.type = type; asset.name = file.name; asset.src = path;
    } else {
      cell.assets.push({ id: `asset-${Math.random().toString(36).slice(2, 10)}`, type, name: file.name, src: path });
    }

    pendingFiles.set(path, { file, objectUrl });
    markDirty();
    renderSections();
    setStatus("媒体已加入本地草稿，需要点击“保存并发布”才会上传。", "info");
  });

  function collectCleanContent() {
    content.title = elements.title.value;
    content.subtitle = elements.subtitle.value;
    content.updatedAt = new Date().toISOString();
    const clone = JSON.parse(JSON.stringify(content));
    clone.sections.forEach((section) => {
      section.rows.forEach((row) => {
        row.cells.forEach((cell) => {
          cell.assets.forEach((asset) => {
            delete asset.file;
            delete asset.objectUrl;
          });
        });
      });
    });
    return clone;
  }

  async function uploadFile(path, file, percentBase, percentSize) {
    let sha = "";
    try {
      const info = await request(`/repos/${elements.owner.value.trim()}/${elements.repo.value.trim()}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(elements.branch.value.trim() || "main")}`);
      sha = info.sha || "";
    } catch (error) {
      if (!/Not Found|404/i.test(error.message)) throw error;
    }
    const encoded = await fileToBase64(file);
    await request(`/repos/${elements.owner.value.trim()}/${elements.repo.value.trim()}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `更新素材 ${path}`,
        content: encoded,
        branch: elements.branch.value.trim() || "main",
        ...(sha ? { sha } : {})
      })
    });
    setProgress(true, percentBase + percentSize);
  }

  async function saveToGithub() {
    if (!content) return;
    if (!dirty) {
      setStatus("没有检测到新修改。请先在表格里修改文字、添加图片，或调整行列后再保存。", "info");
      return;
    }
    const owner = elements.owner.value.trim();
    const repo = elements.repo.value.trim();
    const branch = elements.branch.value.trim() || "main";
    if (!owner || !repo || !elements.token.value.trim()) {
      setStatus("请填写 GitHub 用户名、仓库名和有 Contents 写权限的 Token。", "error");
      return;
    }
    saveConfig();
    const controls = [elements.saveButton, elements.bottomSaveButton, elements.loadButton, elements.localButton, elements.resetButton];
    controls.forEach((control) => { control.disabled = true; });
    setProgress(true, 2);
    setStatus("正在准备保存，请不要关闭页面。", "info");

    try {
      const pending = [];
      content.sections.forEach((section) => section.rows.forEach((row) => row.cells.forEach((cell) => {
        cell.assets.forEach((asset) => {
          if (pendingFiles.has(asset.src)) pending.push({ asset, item: pendingFiles.get(asset.src) });
        });
      })));

      for (let index = 0; index < pending.length; index += 1) {
        setStatus(`正在上传素材 ${index + 1} / ${pending.length}：${pending[index].asset.name}`, "info");
        await uploadFile(pending[index].asset.src, pending[index].item.file, 2 + index * (70 / pending.length), 70 / pending.length);
        pendingFiles.get(pending[index].asset.src).objectUrl && URL.revokeObjectURL(pendingFiles.get(pending[index].asset.src).objectUrl);
        pendingFiles.delete(pending[index].asset.src);
      }

      const info = await request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(contentPath()).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`);
      contentSha = info.sha || contentSha;
      const output = collectCleanContent();
      setStatus("正在保存文字和排版…", "info");
      const result = await request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(contentPath()).replace(/%2F/g, "/")}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "更新装修需求清单",
          content: bytesToBase64(new TextEncoder().encode(JSON.stringify(output, null, 2))),
          branch,
          ...(contentSha ? { sha: contentSha } : {})
        })
      });
      contentSha = result.content && result.content.sha ? result.content.sha : contentSha;
      savedContent = JSON.parse(JSON.stringify(content));
      setProgress(true, 100);
      markDirty(false);
      elements.loadButton.disabled = false;
      elements.localButton.disabled = false;
      elements.resetButton.disabled = false;
      setStatus("已保存。GitHub Pages 通常会在 20秒到2分钟内自动更新；如未变化，请刷新页面。", "ok");
      window.setTimeout(() => setProgress(false), 1200);
    } catch (error) {
      console.error(error);
      controls.forEach((control) => { if (control !== elements.fileInput) control.disabled = false; });
      elements.saveButton.disabled = !dirty;
      elements.bottomSaveButton.disabled = !dirty;
      setProgress(false);
      setStatus(`保存失败：${error.message}\n请检查 Token 权限、仓库名、分支和目录。`, "error");
    }
  }

  async function loadRemote() {
    const owner = elements.owner.value.trim();
    const repo = elements.repo.value.trim();
    const branch = elements.branch.value.trim() || "main";
    if (!owner || !repo) {
      setStatus("请先填写 GitHub 用户名和仓库名。", "error");
      return;
    }
    saveConfig();
    elements.loadButton.disabled = true;
    setStatus("正在加载线上内容…", "info");
    try {
      let decoded = "";
      let usedApi = false;
      if (elements.token.value.trim()) {
        try {
          const result = await request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(contentPath()).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`);
          decoded = decodeBase64(result.content || "");
          contentSha = result.sha || "";
          usedApi = true;
        } catch (_) {
          contentSha = "";
        }
      }
      if (!usedApi) {
        contentSha = "";
        const path = contentPath();
        const candidates = [];
        if (/^https?:$/i.test(window.location.protocol)) {
          candidates.push(`${path}?t=${Date.now()}`);
        }
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        candidates.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodedPath}?t=${Date.now()}`);
        let lastError = null;
        decoded = "";
        for (const candidate of candidates) {
          try {
            const response = await fetch(candidate, { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            decoded = await response.text();
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (!decoded) throw lastError || new Error("找不到线上内容");
      }
      content = normalizeContent(JSON.parse(decoded));
      savedContent = JSON.parse(JSON.stringify(content));
      pendingFiles.clear();
      elements.editor.classList.add("on");
      setEditorValues();
      markDirty(false);
      setStatus(usedApi ? "已加载线上内容。" : "已加载线上内容。未填 Token 也可以编辑；保存发布前需要填 Token。", "ok");
    } catch (error) {
      console.error(error);
      setStatus(`加载失败：${error.message}`, "error");
    } finally {
      elements.loadButton.disabled = false;
    }
  }

  async function loadLocal() {
    try {
      const response = await fetch(`content.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      content = normalizeContent(await response.json());
      savedContent = JSON.parse(JSON.stringify(content));
      pendingFiles.clear();
      elements.editor.classList.add("on");
      setEditorValues();
      markDirty(false);
      setStatus("已加载本地预览内容；这种模式只能编辑，不能保存到 GitHub。", "info");
    } catch (error) {
      setStatus(`本地内容加载失败：${error.message}`, "error");
    }
  }

  function resetChanges() {
    if (!savedContent || !dirty || !window.confirm("放弃所有未保存的修改，恢复到刚加载的内容吗？")) return;
    content = JSON.parse(JSON.stringify(savedContent));
    pendingFiles.clear();
    setEditorValues();
    markDirty(false);
    setStatus("已放弃未保存的修改。", "info");
  }

  elements.title.addEventListener("input", () => { content.title = elements.title.value; markDirty(); });
  elements.subtitle.addEventListener("input", () => { content.subtitle = elements.subtitle.value; markDirty(); });
  elements.loadButton.addEventListener("click", loadRemote);
  elements.localButton.addEventListener("click", loadLocal);
  elements.saveButton.addEventListener("click", saveToGithub);
  elements.bottomSaveButton.addEventListener("click", saveToGithub);
  elements.resetButton.addEventListener("click", resetChanges);
  [elements.owner, elements.repo, elements.branch, elements.directory, elements.token].forEach((input) => input.addEventListener("change", saveConfig));
  window.addEventListener("beforeunload", (event) => {
    if (dirty || pendingFiles.size) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
})();
