// Only the newest asynchronous read may replace the displayed snapshot.
export function createHistoryRefresh(load, commit) {
  let revision = 0;
  return async () => {
    const current = ++revision;
    const rows = await load();
    if (current === revision) commit(rows);
  };
}

export function createHistoryList(list, latestButton) {
  let previousSnapshot = null;
  latestButton.addEventListener('click', () => { list.scrollTop = 0; latestButton.hidden = true; });
  list.addEventListener('scroll', () => { if (list.scrollTop <= 4) latestButton.hidden = true; });
  return rows => {
    const snapshot = JSON.stringify(rows);
    if (snapshot === previousSnapshot) return;
    const oldTop = list.scrollTop;
    const top = list.getBoundingClientRect().top;
    const anchor = [...list.children].find(node => node.getBoundingClientRect().bottom > top);
    const anchorKey = anchor?.dataset.recordKey;
    const anchorOffset = anchor ? anchor.getBoundingClientRect().top - top : 0;
    const oldFirst = list.firstElementChild?.dataset.recordKey;
    const fragment = list.ownerDocument.createDocumentFragment();
    rows.forEach((item, index) => {
      const li = list.ownerDocument.createElement('li');
      // Identity is never based on reply text: separate saves must remain visible.
      li.dataset.recordKey = item.id || `${item.requestId || ''}:${item.createdAt || ''}:${index}`;
      const text = list.ownerDocument.createElement('p'), meta = list.ownerDocument.createElement('small');
      text.textContent = item.reply || '已选择的回复';
      meta.textContent = `${item.style || '回复'} · ${new Date(item.updatedAt || item.createdAt).toLocaleString('zh-CN')}`;
      li.append(text, meta); fragment.append(li);
    });
    if (!rows.length) {
      const empty = list.ownerDocument.createElement('li');
      empty.textContent = '还没有已选择的回复记录。'; fragment.append(empty);
    }
    list.replaceChildren(fragment);
    if (oldTop > 4) {
      const restored = [...list.children].find(node => node.dataset.recordKey === anchorKey);
      list.scrollTop = restored ? restored.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - anchorOffset : oldTop;
      if (oldFirst && oldFirst !== list.firstElementChild?.dataset.recordKey) latestButton.hidden = false;
    } else list.scrollTop = 0;
    if (!rows.length) latestButton.hidden = true;
    previousSnapshot = snapshot;
  };
}
