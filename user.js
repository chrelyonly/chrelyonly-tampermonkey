// ==UserScript==
// @name         精简版图片验证码识别(支持刷新/动态弹窗/提交后重新识别)
// @namespace    https://tampermonkey.chrelyonly.cn
// @version      2.5.3
// @description  精简版验证码识别：支持动态ID、动态弹窗验证码自动识别、点击刷新重新识别、并发防抖控制、纯后端 Redis 管理规则、Toast 浮动提示
// @author       chrelyonly
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      tampermonkey.chrelyonly.cn
// ==/UserScript==

(function () {
    'use strict';

    const API_URL = 'https://tampermonkey.chrelyonly.cn/orc-api/getCode';
    const GET_RULE_URL = 'https://tampermonkey.chrelyonly.cn/orc-api/getRules';
    const SAVE_RULE_URL = 'https://tampermonkey.chrelyonly.cn/orc-api/saveRule';

    let isBinding = false;
    let currentRules = [];
    let bindHandler = null;
    let bindKeyHandler = null;

    // Toast 提示
    function showToast(message, type = 'info', duration = 3000) {
        const toastId = 'custom-script-toast';
        let toastContainer = document.getElementById(toastId);

        if (!toastContainer) {
            const style = document.createElement('style');
            style.innerHTML = `
                #custom-script-toast {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 9999999;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    pointer-events: none;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                }
                .script-toast-item {
                    min-width: 220px;
                    max-width: 360px;
                    padding: 12px 18px;
                    border-radius: 8px;
                    color: #fff;
                    font-size: 14px;
                    line-height: 1.4;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    backdrop-filter: blur(8px);
                    opacity: 0;
                    transform: translateY(-20px) scale(0.95);
                    transition: all 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
                    pointer-events: auto;
                    word-break: break-all;
                }
                .script-toast-item.show { opacity: 1; transform: translateY(0) scale(1); }
                .script-toast-info { background: rgba(30, 30, 30, 0.88); }
                .script-toast-success { background: rgba(46, 125, 50, 0.92); }
                .script-toast-error { background: rgba(211, 47, 47, 0.92); }
                .script-toast-warning { background: rgba(230, 81, 0, 0.92); }
            `;
            document.head.appendChild(style);

            toastContainer = document.createElement('div');
            toastContainer.id = toastId;
            document.body.appendChild(toastContainer);
        }

        const toast = document.createElement('div');
        toast.className = `script-toast-item script-toast-${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove());
        }, duration);
    }

    function isImageElement(el) {
        if (!el || el.nodeType !== 1) return false;
        const tagName = el.tagName.toLowerCase();
        if (tagName === 'img' || tagName === 'canvas') return true;

        const style = window.getComputedStyle(el);
        return style.backgroundImage && style.backgroundImage !== 'none';
    }

    function isInputElement(el) {
        if (!el || el.nodeType !== 1) return false;
        const tagName = el.tagName.toLowerCase();
        if (tagName === 'input') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            return ['text', 'password', 'number', 'tel', 'search'].includes(type);
        }
        return el.isContentEditable;
    }

    function getStableSelector(el) {
        if (!el || el.nodeType !== 1) return null;
        if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
        if (el.getAttribute('placeholder')) {
            return `${el.tagName.toLowerCase()}[placeholder="${CSS.escape(el.getAttribute('placeholder'))}"]`;
        }
        if (el.id && !/\d{5,}/.test(el.id)) {
            return `#${CSS.escape(el.id)}`;
        }

        const path = [];
        while (el && el.nodeType === 1 && el !== document.body) {
            let selector = el.tagName.toLowerCase();
            if (el.parentElement) {
                const siblings = Array.from(el.parentElement.children).filter(c => c.tagName === el.tagName);
                if (siblings.length > 1) {
                    selector += `:nth-of-type(${siblings.indexOf(el) + 1})`;
                }
            }
            path.unshift(selector);
            el = el.parentElement;
        }
        return path.join(' > ');
    }

    async function imgToBase64(imgEl) {
        if (imgEl.tagName.toLowerCase() === 'canvas') {
            try {
                return imgEl.toDataURL('image/png');
            } catch (e) {
                return null;
            }
        }

        const src = imgEl.src || imgEl.getAttribute('src');
        if (src && src.startsWith('data:image/')) return src;

        return new Promise((resolve) => {
            const drawCanvas = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = imgEl.naturalWidth || imgEl.offsetWidth || 100;
                    canvas.height = imgEl.naturalHeight || imgEl.offsetHeight || 40;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(imgEl, 0, 0);
                    resolve(canvas.toDataURL('image/png'));
                } catch (e) {
                    resolve(src);
                }
            };

            if (imgEl.tagName.toLowerCase() === 'img') {
                if (imgEl.complete && imgEl.naturalWidth > 0) {
                    drawCanvas();
                } else {
                    const onLoad = () => {
                        imgEl.removeEventListener('load', onLoad);
                        drawCanvas();
                    };
                    imgEl.addEventListener('load', onLoad);
                    setTimeout(() => resolve(src), 1500);
                }
            } else {
                drawCanvas();
            }
        });
    }

    function setInputValue(inputEl, value) {
        if (!inputEl || !value) return;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(inputEl, value);
        } else {
            inputEl.value = value;
        }

        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    // 防抖调度器：存储每条规则的 Timer，实现 300ms 节流防抖
    const recognizeTimers = new Map();

    function scheduleRecognize(rule, force = false, delay = 300) {
        if (!rule || !rule.img) return;

        if (recognizeTimers.has(rule.img)) {
            clearTimeout(recognizeTimers.get(rule.img));
        }

        const timer = setTimeout(() => {
            recognize(rule, force);
            recognizeTimers.delete(rule.img);
        }, delay);

        recognizeTimers.set(rule.img, timer);
    }

    // OCR 发送与识别 (带锁控制)
    async function recognize(rule, force = false) {
        if (!rule || !rule.img || !rule.input) return;
        const imgEl = document.querySelector(rule.img);
        const inputEl = document.querySelector(rule.input);

        if (!imgEl || !inputEl || imgEl.offsetWidth === 0 || imgEl.offsetHeight === 0) return;

        // 如果不是强制重新识别，且已识别或正在识别中，则终止
        if (!force && (imgEl.__hasRecognized || imgEl.__isRecognizing)) return;

        // 立即上并发锁，防止同一图片被多个异步任务同时调用
        imgEl.__isRecognizing = true;
        console.log('[验证码识别] 开始识别:', rule);

        try {
            const base64 = await imgToBase64(imgEl);
            if (!base64) {
                imgEl.__isRecognizing = false;
                return;
            }

            GM_xmlhttpRequest({
                method: 'POST',
                url: API_URL,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({
                    image: base64,
                    img: base64,
                    host: window.location.host,
                    path: window.location.href,
                    ocr_type: 1,
                    timestamp: Date.now()
                }),
                onload: (res) => {
                    imgEl.__isRecognizing = false;
                    imgEl.__hasRecognized = true; // 标记完成
                    try {
                        const data = JSON.parse(res.responseText);
                        const code = data?.data?.data?.result || data?.data?.result || data?.result;
                        if (code) {
                            setInputValue(inputEl, code);
                            showToast(`验证码识别成功: ${code}`, 'success');
                        } else {
                            showToast('验证码识别为空', 'warning');
                        }
                    } catch (err) {
                        console.error('[验证码识别] 解析响应失败:', err);
                    }
                },
                onerror: () => {
                    imgEl.__isRecognizing = false;
                    showToast('请求识别接口失败', 'error');
                }
            });
        } catch (e) {
            imgEl.__isRecognizing = false;
            console.error('[验证码提取失败]', e);
        }
    }

    function bindImageEvents(rule) {
        if (!rule || !rule.img) return;
        const imgEl = document.querySelector(rule.img);
        if (!imgEl || imgEl.__hasBindCaptcha) return;

        imgEl.__hasBindCaptcha = true;

        // 点击图片手动刷新：强制识别
        imgEl.addEventListener('click', () => {
            console.log('[验证码刷新] 触发手动点击刷新');
            scheduleRecognize(rule, true, 200);
        });

        // 监听 src 属性改变
        if (window.MutationObserver) {
            const srcObserver = new MutationObserver((mutations) => {
                for (let mutation of mutations) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                        console.log('[验证码刷新] 监测到图片 SRC 变化');
                        scheduleRecognize(rule, true, 300);
                        break;
                    }
                }
            });
            srcObserver.observe(imgEl, { attributes: true, attributeFilter: ['src'] });
        }
    }

    // 监听表单提交/点击提交按钮动作
    function bindSubmitEvents(rules) {
        if (!Array.isArray(rules) || rules.length === 0) return;

        const handleFormSubmit = () => {
            console.log('[表单提交] 检测到提交动作，等待页面/图片响应...');
            rules.forEach(rule => {
                // 提交后重置标记并使用 Schedule 延迟统一识别，避免与 SRC 变动重复触发
                const imgEl = document.querySelector(rule.img);
                if (imgEl) imgEl.__hasRecognized = false;

                scheduleRecognize(rule, true, 800);
            });
        };

        document.addEventListener('submit', handleFormSubmit, true);

        document.addEventListener('click', (e) => {
            const target = e.target;
            if (!target) return;

            const isSubmitBtn =
                target.type === 'submit' ||
                target.getAttribute('role') === 'button' ||
                /提交|登录|登陆|注册|确定|Submit|Login/i.test(target.innerText || target.value || '');

            if (isSubmitBtn) {
                handleFormSubmit();
            }
        }, true);
    }

    // 动态 DOM 变动监听
    let observerTimer = null;
    function observeDynamicPopup(rules) {
        if (!Array.isArray(rules) || rules.length === 0) return;

        const observer = new MutationObserver((mutations) => {
            const isToastMutation = mutations.every(m =>
                m.target.id === 'custom-script-toast' ||
                m.target.closest('#custom-script-toast')
            );
            if (isToastMutation) return;

            if (observerTimer) clearTimeout(observerTimer);
            observerTimer = setTimeout(() => {
                rules.forEach(rule => {
                    const imgEl = document.querySelector(rule.img);
                    const inputEl = document.querySelector(rule.input);
                    if (imgEl && inputEl && imgEl.offsetWidth > 0) {
                        bindImageEvents(rule);
                        if (!imgEl.__hasRecognized && !imgEl.__isRecognizing) {
                            scheduleRecognize(rule, false, 100);
                        }
                    }
                });
            }, 300);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'style', 'class']
        });
    }

    function fetchRulesFromServer() {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${GET_RULE_URL}?host=${encodeURIComponent(window.location.host)}`,
                onload: (res) => {
                    try {
                        const response = JSON.parse(res.responseText);
                        let rulesData = response?.data;
                        if (rulesData && !Array.isArray(rulesData) && rulesData.img) {
                            rulesData = [rulesData];
                        }
                        resolve(Array.isArray(rulesData) ? rulesData : []);
                    } catch (e) {
                        resolve([]);
                    }
                },
                onerror: () => resolve([])
            });
        });
    }

    function saveRuleToServer(rule) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: SAVE_RULE_URL,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(rule),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        const isSuccess = data?.code === 200 || data?.code === 0 || data?.success === true || (data?.msg && data.msg.includes('成功'));
                        resolve(isSuccess);
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: (err) => reject(err)
            });
        });
    }

    function stopBind() {
        isBinding = false;
        if (bindHandler) {
            document.removeEventListener('click', bindHandler, true);
            bindHandler = null;
        }
        if (bindKeyHandler) {
            document.removeEventListener('keydown', bindKeyHandler, true);
            bindKeyHandler = null;
        }
    }

    function startBind() {
        if (isBinding) return;
        isBinding = true;

        showToast('请按顺序点击：1. 验证码图片 -> 2. 验证码输入框 (按 Esc 取消)', 'info', 6000);
        let tempImg = null;

        bindKeyHandler = (e) => {
            if (e.key === 'Escape') {
                stopBind();
                showToast('已取消规则绑定', 'warning');
            }
        };
        document.addEventListener('keydown', bindKeyHandler, true);

        bindHandler = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const target = e.target;

            if (!tempImg) {
                if (!isImageElement(target)) {
                    showToast('点击无效：请点击正确的验证码图片！', 'warning');
                    return;
                }
                tempImg = target;
                showToast('已选择图片，请点击对应的输入框', 'info', 4000);
            } else {
                if (!isInputElement(target)) {
                    showToast('点击无效：请点击正确的输入框！', 'warning');
                    return;
                }

                const rule = {
                    host: window.location.host,
                    img: getStableSelector(tempImg),
                    input: getStableSelector(target)
                };

                stopBind();

                try {
                    const success = await saveRuleToServer(rule);
                    if (success) {
                        showToast('规则上传保存成功！', 'success');
                        currentRules.push(rule);
                        bindImageEvents(rule);
                        scheduleRecognize(rule, true, 100);
                        observeDynamicPopup(currentRules);
                    } else {
                        showToast('保存规则失败，请检查后端', 'error');
                    }
                } catch (err) {
                    showToast('网络或服务端异常', 'error');
                }
            }
        };

        document.addEventListener('click', bindHandler, true);
    }

    async function init() {
        GM_registerMenuCommand('绑定当前页验证码并上传', startBind);
        GM_registerMenuCommand('手动识别', async () => {
            const rules = currentRules.length > 0 ? currentRules : await fetchRulesFromServer();
            if (rules.length > 0) {
                rules.forEach(rule => scheduleRecognize(rule, true, 50));
            } else {
                showToast('未查找到当前页面的绑定规则', 'error');
            }
        });

        currentRules = await fetchRulesFromServer();
        if (currentRules.length > 0) {
            setTimeout(() => {
                currentRules.forEach(rule => {
                    bindImageEvents(rule);
                    scheduleRecognize(rule, false, 200);
                });
            }, 500);

            bindSubmitEvents(currentRules);
            observeDynamicPopup(currentRules);
        }
    }

    init();
})();