/**
 * dsh-superagent-reset ——「设置 → 通用设置」里的一行（浏览器半身）。
 *
 * 一行说明 + 一个按钮。点「初始化」要按第二次确认，然后只写一个排队标记；
 * 真正把 master 会话搬进备份是 `npm start` 时启动器干的——host 跑着的时候
 * 那些文件是它自己打开的，删不了。
 *
 * 文案写死中文，没有 locale 注册：这是本仓自己的插件，跟 dsh-daily 一样。
 */

window.__ModuleLoader__.load({
  id: 'dsh-superagent-reset',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const inject = ['slots'];
    const API = '/dsh-superagent-reset/api';

    const CSS = `
      .sar-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px 0}
      .sar-main{min-width:0;display:flex;flex-direction:column;gap:4px}
      .sar-title{font-size:13.5px;font-weight:600;color:var(--dsw-fg,#2b2622)}
      .sar-desc{font-size:12px;line-height:1.6;color:var(--dsw-fg-muted,#77706a)}
      .sar-path{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-fg-muted,#77706a);word-break:break-all}
      .sar-note{margin-top:6px;font-size:11.5px;line-height:1.5;color:var(--dsw-fg-muted,#77706a)}
      .sar-note.bad{color:#b0453a}
      .sar-actions{flex:none;display:flex;align-items:center;gap:8px}
      .sar-btn{appearance:none;border:1px solid rgba(43,38,34,.18);background:transparent;color:inherit;
        border-radius:8px;padding:5px 12px;font-size:12px;line-height:1.5;cursor:pointer}
      .sar-btn:hover:not(:disabled){background:rgba(43,38,34,.05)}
      .sar-btn.primary{border-color:rgba(176,69,58,.5);color:#b0453a}
      .sar-btn.primary:hover:not(:disabled){background:rgba(176,69,58,.08)}
      .sar-btn:disabled{opacity:.45;cursor:default}
      .sar-tag{font-size:12px;color:#b0453a}
    `;

    let styled = false;
    function ensureStyle() {
      if (styled) return;
      styled = true;
      const style = document.createElement('style');
      style.dataset.plugin = 'dsh-superagent-reset';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    async function call(path, options) {
      const request = { cache: 'no-store', ...options };
      if (options !== undefined && options.body !== undefined) {
        request.headers = { 'content-type': 'application/json' };
      }
      const response = await fetch(API + path, request);
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error('HTTP ' + response.status);
      }
      if (!response.ok || data.ok === false) throw new Error(data.message || ('HTTP ' + response.status));
      return data;
    }

    const kilobytes = (bytes) => {
      if (!bytes) return '';
      return bytes < 1024 ? ' · ' + bytes + ' B' : ' · ' + (bytes / 1024).toFixed(1) + ' KiB';
    };

    const when = (iso) => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (value) => String(value).padStart(2, '0');
      return (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    };

    /* 只报「有几项会搬、多大」——路径对用户没有用，长度也没有。 */
    function summary(data) {
      const present = data.targets.filter((item) => item.exists);
      if (present.length === 0) return '当前没有可搬的东西（会话已经是空的）。';
      const bytes = present.reduce((total, item) => total + (item.bytes || 0), 0);
      const labels = present.map((item) => item.label).join('、');
      return '会搬走 ' + present.length + ' 项：' + labels + kilobytes(bytes) + '。';
    }

    function Row() {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [confirming, setConfirming] = React.useState(false);
      const [busy, setBusy] = React.useState(false);

      const load = React.useCallback(async () => {
        try {
          const next = await call('/status');
          setData(next);
          setError('');
        } catch (failure) {
          setError(String(failure && failure.message ? failure.message : failure));
        }
      }, []);

      React.useEffect(() => { void load(); }, [load]);

      const act = React.useCallback(async (path) => {
        setBusy(true);
        try {
          setData(await call(path, { method: 'POST', body: JSON.stringify({ confirm: true }) }));
          setError('');
          setConfirming(false);
        } catch (failure) {
          setError(String(failure && failure.message ? failure.message : failure));
        } finally {
          setBusy(false);
        }
      }, []);

      const pending = Boolean(data && data.pending);
      const last = data ? data.last : null;

      const description = pending
        ? '已排队。下次启动（npm start）时，host 还没起来之前执行；在那之前什么都不动。'
        : '把 master 会话的历史连同两份投影缓存搬进 backups/。工单、设置、提示词修订、记忆卡、人格都不动；搬走之后那条会话会是一条空的。host 跑着的时候这些文件被它自己打开着，所以点了下次启动才执行。';

      const actions = [];
      if (error) {
        actions.push(h('button', { key: 'retry', className: 'sar-btn', type: 'button', onClick: () => { void load(); } }, '重试'));
      }
      if (pending) {
        actions.push(h('span', { key: 'tag', className: 'sar-tag' }, '已排队'));
        actions.push(h('button', {
          key: 'cancel', className: 'sar-btn', type: 'button', disabled: busy,
          onClick: () => { void act('/cancel'); },
        }, '取消'));
      } else if (data) {
        if (confirming) {
          actions.push(h('button', {
            key: 'ok', className: 'sar-btn primary', type: 'button', disabled: busy,
            onClick: () => { void act('/queue'); },
          }, busy ? '提交中…' : '确认初始化'));
          actions.push(h('button', {
            key: 'no', className: 'sar-btn', type: 'button', disabled: busy,
            onClick: () => { setConfirming(false); },
          }, '算了'));
        } else {
          actions.push(h('button', {
            key: 'init', className: 'sar-btn', type: 'button', disabled: busy,
            onClick: () => { setConfirming(true); },
          }, '初始化'));
        }
      }

      const notes = [];
      if (error) notes.push(h('div', { key: 'err', className: 'sar-note bad' }, error));
      if (data) notes.push(h('div', { key: 'sum', className: 'sar-note' }, summary(data)));
      if (last) {
        notes.push(h('div', {
          key: 'last',
          className: last.ok ? 'sar-note' : 'sar-note bad',
        }, last.ok
          ? '上次执行：' + when(last.at) + '，搬走 ' + last.moved.length + ' 项 → ' + last.backup
          : '上次执行失败：' + when(last.at) + '，' + (last.failures.map((item) => item.path).join('、') || '未知原因') + '；已保留排队，下次启动再试。'));
      }

      return h('div', { className: 'sar-row' }, [
        h('div', { key: 'main', className: 'sar-main' }, [
          h('div', { key: 'title', className: 'sar-title' }, '初始化 Superagent 会话'),
          h('div', { key: 'desc', className: 'sar-desc' }, description),
          notes.length > 0 ? h('div', { key: 'notes' }, notes) : null,
        ]),
        h('div', { key: 'actions', className: 'sar-actions' }, actions),
      ]);
    }

    function apply(ctx) {
      ensureStyle();
      /* `settings.general.item` 是「设置 → 通用」里那一列，order 让它落在偏好类条目之后。 */
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'superagent-reset',
        order: 80,
      }, Row));
    }

    return { name: 'dsh-superagent-reset', inject, apply };
  },
});
