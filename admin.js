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

  elements.owner.value = localStorage.getItem(`${STORAGE_KEY}:owner`) || "";
  elements.repo.value = localStorage.getItem(`${STORAGE_KEY}:repo`) || "";
  elements.branch.value = localStorage.getItem(`${STORAGE_KEY}:branch`) || "main";
  elements.directory.value = localStorage.getItem(`${STORAGE_KEY}:directory`) || "";

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
    const response = await fetch(url, { ...options, headers: { ...apiHeaders(), ...(options.headers || {}) } });
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
    elements.saveButton.disabled = !state;
    elements.bottomSaveButton.disabled = !state;
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
      sectionHead.appendChild(sectionTitle);

      const headersBox = document.createElement("div");
      headersBox.className = "form-grid";
      headersBox.style.marginTop = "10px";
      (section.headers.length ? section.headers : ["", "", "", ""]).forEach((header, headerIndex) => {
        const field = document.createElement("div");
        field.className = "field";
        const label = document.createElement("label");
        label.textContent = `表头 ${headerIndex + 1}`;
        const input = document.createElement("input");
        input.value = header || "";
        input.addEventListener("input", () => {
          section.headers[headerIndex] = input.value;
          markDirty();
        });
        field.append(label, input);
        headersBox.appendChild(field);
      });

      card.append(sectionHead, headersBox);
      section.rows.forEach((row, rowIndex) => card.appendChild(createRow(section, row, sectionIndex, rowIndex)));

      const addRow = document.createElement("button");
      addRow.type = "button";
      addRow.className = "add-row";
      addRow.textContent = "在这一节新增一行";
      addRow.addEventListener("click", () => {
        const last = section.rows[section.rows.length - 1];
        const count = last && Array.isArray(last.cells) ? last.cells.length : section.headers.length || 4;
        section.rows.push({
          id: `row-${Date.now()}`,
          cells: Array.from({ length: count }, (_, index) => ({ id: `cell-${Date.now()}-${index}`, html: "", assets: [] }))
        });
        markDirty();
        renderSections();
      });
      card.appendChild(addRow);
      wrapper.appendChild(card);
      elements.sections.appendChild(wrapper);
    });
  }

  function createRow(section, row, sectionIndex, rowIndex) {
    const card = document.createElement("div");
    card.className = "row-card";
    const tools = document.createElement("div");
    tools.className = "row-tools";
    const label = document.createElement("span");
    label.textContent = `第 ${rowIndex + 1} 行`;
    const buttons = document.createElement("div");
    buttons.style.display = "flex";
    buttons.style.gap = "5px";

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
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "mini danger"; remove.textContent = "删除";
    remove.addEventListener("click", () => {
      if (!window.confirm("确定删除这一行吗？媒体引用也会一起删除。")) return;
      section.rows.splice(rowIndex, 1);
      markDirty(); renderSections();
    });
    buttons.append(up, down, remove);
    tools.append(label, buttons);
    card.appendChild(tools);

    const cells = document.createElement("div");
    cells.className = "cells";
    row.cells.forEach((cell, cellIndex) => {
      const box = document.createElement("div");
      box.className = "cell-box";
      const cellLabel = document.createElement("div");
      cellLabel.className = "cell-label";
      const name = document.createElement("span");
      name.textContent = section.headers[cellIndex] || `第 ${cellIndex + 1} 格`;
      cellLabel.appendChild(name);
      const addMedia = document.createElement("button");
      addMedia.type = "button"; addMedia.className = "mini"; addMedia.textContent = "添加图片/视频";
      addMedia.addEventListener("click", () => {
        uploadTarget = { mode: "add", sectionIndex, rowIndex, cellIndex };
        elements.fileInput.value = "";
        elements.fileInput.click();
      });
      cellLabel.appendChild(addMedia);

      const textarea = document.createElement("textarea");
      textarea.value = cell.html || "";
      textarea.placeholder = "直接输入文字。换行会正常显示；也可以粘贴链接。";
      textarea.addEventListener("input", () => {
        cell.html = textarea.value;
        markDirty();
      });
      box.append(cellLabel, textarea);

      const assetGrid = document.createElement("div");
      assetGrid.className = "asset-grid";
      (cell.assets || []).forEach((asset, assetIndex) => {
        const assetCard = document.createElement("div");
        assetCard.className = "asset-card";
        if (pendingFiles.has(asset.src)) assetCard.classList.add("pending");
        if (asset.type === "video") {
          const video = document.createElement("video");
          video.className = "asset-preview"; video.controls = true; video.preload = "metadata"; video.src = previewSource(asset);
          assetCard.appendChild(video);
        } else {
          const image = document.createElement("img");
          image.className = "asset-preview"; image.loading = "lazy"; image.alt = asset.name || ""; image.src = previewSource(asset);
          assetCard.appendChild(image);
        }
        const assetName = document.createElement("div");
        assetName.className = "asset-name";
        assetName.textContent = `${asset.type === "video" ? "视频" : "图片"} · ${asset.name || asset.src}`;
        const actions = document.createElement("div");
        actions.className = "asset-actions";
        const replace = document.createElement("button");
        replace.type = "button"; replace.className = "mini"; replace.textContent = "替换";
        replace.addEventListener("click", () => {
          uploadTarget = { mode: "replace", sectionIndex, rowIndex, cellIndex, assetIndex };
          elements.fileInput.value = "";
          elements.fileInput.click();
        });
        const removeAsset = document.createElement("button");
        removeAsset.type = "button"; removeAsset.className = "mini danger"; removeAsset.textContent = "删除";
        removeAsset.addEventListener("click", () => {
          cell.assets.splice(assetIndex, 1);
          markDirty(); renderSections();
        });
        actions.append(replace, removeAsset);
        assetCard.append(assetName, actions);
        assetGrid.appendChild(assetCard);
      });
      box.appendChild(assetGrid);
      cells.appendChild(box);
    });
    card.appendChild(cells);
    return card;
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
      const result = await request(`/repos/${owner}/${repo}/contents/${encodeURIComponent(contentPath()).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`);
      const decoded = decodeBase64(result.content || "");
      content = normalizeContent(JSON.parse(decoded));
      savedContent = JSON.parse(JSON.stringify(content));
      contentSha = result.sha || "";
      pendingFiles.clear();
      elements.editor.classList.add("on");
      setEditorValues();
      markDirty(false);
      setStatus("已加载线上内容。", "ok");
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
