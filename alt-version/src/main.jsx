import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, ChevronDown, Download, FileText, Loader2, Settings, Sparkles, Upload, XCircle } from 'lucide-react';
import JSZip from 'jszip';
import mammoth from 'mammoth/mammoth.browser';
import { XMLParser } from 'fast-xml-parser';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

const STORAGE_KEYS = {
  config: 'study-helper-config-v1',
  documents: 'study-helper-documents-v1',
  wrongBatches: 'study-helper-wrong-batches-v2',
  lastSet: 'study-helper-last-question-set-v1',
};
const DEFAULT_CONFIG = { baseUrl: 'https://api.freemodel.dev/v1', model: 'gpt-5.5', apiKey: '' };
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const TABS = [{ id: 'upload', label: '上传资料' }, { id: 'practice', label: '开始练习' }, { id: 'wrong', label: '错题本' }];

function App() {
  const [activeTab, setActiveTab] = useState('upload');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useLocalStorage(STORAGE_KEYS.config, DEFAULT_CONFIG);
  const [documents, setDocuments] = useLocalStorage(STORAGE_KEYS.documents, []);
  const [wrongBatches, setWrongBatches] = useLocalStorage(STORAGE_KEYS.wrongBatches, []);
  const [lastSet, setLastSet] = useLocalStorage(STORAGE_KEYS.lastSet, null);
  const [fileState, setFileState] = useState(null);
  const [summary, setSummary] = useState(null);
  const [questions, setQuestions] = useState(lastSet);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [practiceDone, setPracticeDone] = useState(false);
  const [expandedBatches, setExpandedBatches] = useState({});
  const [status, setStatus] = useState({ type: 'idle', message: '' });
  const [statusFading, setStatusFading] = useState(false);

  useEffect(() => setQuestions(lastSet), [lastSet]);
  useEffect(() => {
    if (!status.message) return;
    setStatusFading(false);
    const t1 = setTimeout(() => setStatusFading(true), 0);
    const t2 = setTimeout(() => { setStatus({ type: 'idle', message: '' }); setStatusFading(false); }, 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [status.message]);

  const selectedSourceText = useMemo(() => (summary ? formatSummaryForPrompt(summary) : fileState?.text || ''), [summary, fileState]);
  const currentQuestion = questions?.choiceQuestions?.[currentIndex];
  const selectedForCurrent = currentQuestion ? selectedAnswers[currentQuestion.id] : '';
  const progress = questions?.choiceQuestions?.length ? ((currentIndex + (practiceDone ? 1 : 0)) / questions.choiceQuestions.length) * 100 : 0;

  useEffect(() => {
    const onKeyDown = (e) => {
      if (activeTab !== 'practice' || !currentQuestion || practiceDone) return;
      const key = e.key.toUpperCase();
      if (['A', 'B', 'C', 'D'].includes(key)) setSelectedAnswers((a) => ({ ...a, [currentQuestion.id]: key }));
      if (e.code === 'Space') { e.preventDefault(); if (selectedAnswers[currentQuestion.id]) goNextQuestion(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, currentQuestion, practiceDone, selectedAnswers]);

  async function handleFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setStatus({ type: 'error', message: '文件超过 80MB，请拆分或压缩后再上传。' });
    setStatus({ type: 'loading', message: '正在解析文件...' });
    setSummary(null);
    try {
      const text = normalizeText(await extractText(file));
      if (!text || text.length < 40) throw new Error('提取到的文字太少，请确认文件不是扫描图片，或换成可复制文字的版本。');
      setFileState({ name: file.name, size: file.size, type: file.name.split('.').pop()?.toLowerCase(), text });
      setStatus({ type: 'success', message: '已解析文件，可以生成复习重点。' });
    } catch (e) {
      setFileState(null);
      setStatus({ type: 'error', message: e.message || '文件解析失败。' });
    }
  }

  async function generateSummary() {
    if (!fileState?.text) return setStatus({ type: 'error', message: '请先上传并解析文件。' });
    if (!config.apiKey.trim()) { setSettingsOpen(true); return setStatus({ type: 'error', message: '请先在右上角设置里填写 API Key。' }); }
    setStatus({ type: 'loading', message: '正在生成复习重点...' });
    try {
      const result = await requestJson(config, [{ role: 'system', content: '你是课程复习助手。只输出合法 JSON，不输出 Markdown，内容使用中文。' }, { role: 'user', content: `请根据下面资料整理复习重点并仅返回JSON。资料：${limitForPrompt(fileState.text, 28000)}` }]);
      const normalized = normalizeSummary(result, fileState.name);
      setSummary(normalized);
      const doc = await createStudyDocx(normalized, fileState.name);
      setDocuments((items) => [doc, ...items].slice(0, 20));
      setStatus({ type: 'success', message: '复习重点已生成，并已加入文件列表。' });
    } catch (e) { setStatus({ type: 'error', message: e.message || '生成复习重点失败。' }); }
  }

  async function generateQuestionSet(kind = 'choice') {
    if (!config.apiKey.trim()) { setSettingsOpen(true); return setStatus({ type: 'error', message: '请先在右上角设置里填写 API Key。' }); }
    if (!selectedSourceText || selectedSourceText.length < 40) { setActiveTab('upload'); return setStatus({ type: 'error', message: '请先上传资料，或生成复习重点后再出题。' }); }
    setActiveTab('practice');
    setStatus({ type: 'loading', message: `正在生成 ${kind === 'choice' ? '10 道选择题' : '3 道大题'}...` });
    try {
      const result = await requestJson(config, [{ role: 'system', content: '你是课程考试出题助手。只输出合法 JSON。' }, { role: 'user', content: `输出JSON，模式=${kind}，资料：${limitForPrompt(selectedSourceText, 26000)}` }]);
      const normalized = normalizeQuestionSet(result, kind === 'choice' ? '选择题练习' : '大题练习', fileState?.name || summary?.title || '当前资料', kind);
      startPractice(normalized);
      setLastSet(normalized);
      setStatus({ type: 'success', message: '题目已生成，可以开始练习。' });
    } catch (e) { setStatus({ type: 'error', message: e.message || '生成题目失败。' }); }
  }

  function startPractice(set) { if (!set) return; setQuestions(set); setCurrentIndex(0); setSelectedAnswers({}); setPracticeDone(false); setActiveTab('practice'); }
  function goNextQuestion() { if (!questions || !currentQuestion || !selectedAnswers[currentQuestion.id]) return; if (currentIndex >= questions.choiceQuestions.length - 1) return finishPractice(); setCurrentIndex((i) => i + 1); }
  function finishPractice() {
    if (!questions) return;
    const wrongItems = questions.choiceQuestions.filter((q) => selectedAnswers[q.id] !== q.answer).map((q) => ({ id: crypto.randomUUID(), question: q, selectedAnswer: selectedAnswers[q.id] || '未作答', correctAnswer: q.answer, explanation: q.explanation }));
    if (wrongItems.length) {
      setWrongBatches((items) => [{ id: crypto.randomUUID(), sourceName: questions.sourceName || fileState?.name || summary?.title || '未命名资料', title: questions.title, createdAt: new Date().toISOString(), total: questions.choiceQuestions.length, wrongItems }, ...items].slice(0, 50));
    }
    setPracticeDone(true);
    setStatus({ type: 'success', message: wrongItems.length ? `练习完成，已记录${wrongItems.length}道错题` : '练习完成，没有错题' });
  }

  return <main className="app-shell"><header className="app-nav"><div className="brand">paper latte</div><nav className="tabs" aria-label="主导航">{TABS.map((tab) => <button key={tab.id} className={`tab-button ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</nav></header>{settingsOpen && <SettingsDrawer config={config} setConfig={setConfig} onClose={() => setSettingsOpen(false)} />}<div className="content-shell"><StatusBar status={status} fading={statusFading} />{activeTab === 'upload' && <UploadTab fileState={fileState} summary={summary} documents={documents} setDocuments={setDocuments} status={status} onFile={handleFile} onGenerateSummary={generateSummary} onClear={() => { setFileState(null); setSummary(null); setStatus({ type: 'idle', message: '' }); }} onOpenSettings={() => setSettingsOpen(true)} />}{activeTab === 'practice' && <PracticeTab questions={questions} currentIndex={currentIndex} currentQuestion={currentQuestion} selectedForCurrent={selectedForCurrent} selectedAnswers={selectedAnswers} progress={progress} practiceDone={practiceDone} onSelect={(label) => currentQuestion && !practiceDone && setSelectedAnswers((a) => ({ ...a, [currentQuestion.id]: label }))} onNext={goNextQuestion} onGenerateChoice={() => generateQuestionSet('choice')} onGenerateEssay={() => generateQuestionSet('essay')} />}{activeTab === 'wrong' && <WrongBookTab batches={wrongBatches} expandedBatches={expandedBatches} setExpandedBatches={setExpandedBatches} />}</div></main>;
}

function SettingsDrawer({ config, setConfig, onClose }) { return <div className="drawer-layer" onMouseDown={onClose}><aside className="settings-drawer" onMouseDown={(e) => e.stopPropagation()}><div className="drawer-head"><h2>接口设置</h2><button className="text-button" onClick={onClose}>完成</button></div><label><span>API Base URL</span><input value={config.baseUrl} onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })} placeholder="https://api.freemodel.dev/v1" /></label><label><span>模型</span><input value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} placeholder="gpt-5.5" /></label><label><span>API Key</span><input type="password" value={config.apiKey} onChange={(e) => setConfig({ ...config, apiKey: e.target.value })} placeholder="仅保存在本机浏览器" /></label><p className="prompt-hint">这些信息仅用于本机请求，不会写入项目文件。</p></aside></div>; }
function StatusBar({ status, fading = false }) { if (!status.message) return null; return <div className={`status-bar ${status.type} ${fading ? 'fading' : ''}`}>{status.type === 'loading' && <Loader2 className="spin" size={17} />}{status.type === 'success' && <CheckCircle2 size={17} />}{status.type === 'error' && <XCircle size={17} />}<span>{status.message}</span></div>; }
function PanelIntro({ title, subtitle }) { return <div className="panel-intro"><div><h1>{title}</h1><p>{subtitle}</p></div></div>; }

function UploadTab({ fileState, summary, documents, setDocuments, status, onFile, onGenerateSummary, onClear, onOpenSettings }) { return <section className="tab-panel upload-panel"><label className="drop-zone"><span className="decor upload-decor-a">paper latte</span><span className="decor upload-decor-b">quiet notes for brighter recall</span><input type="file" accept=".pdf,.pptx,.docx" onChange={(e) => onFile(e.target.files?.[0])} /><Upload size={42} /><strong>拖拽或点击上传资料</strong><span className="prompt-hint">PDF / PPTX / DOCX，单文件上限 80MB</span></label>{fileState && <div className="file-card"><FileText size={22} /><div><strong>{fileState.name}</strong><span>{formatBytes(fileState.size)} · 已提取 {fileState.text.length.toLocaleString()} 字</span></div></div>}{summary && <article className="summary-preview"><h3>{summary.title}</h3><p>{summary.overview}</p></article>}<DocumentList documents={documents} setDocuments={setDocuments} /><div className="upload-action-grid"><button className="upload-block-button" onClick={onGenerateSummary} disabled={!fileState || status.type === 'loading'}>{status.type === 'loading' ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}生成复习重点.docx</button><button className="upload-block-button" onClick={onClear} disabled={!fileState}>清空</button><button className="upload-block-button icon-only" onClick={onOpenSettings} aria-label="打开设置"><Settings size={20} /></button></div></section>; }
function DocumentList({ documents, setDocuments }) { return <div className="document-list-wrap"><div className="section-head document-list-label"><h2>生成文件列表</h2>{documents.length > 0 && <button className="text-button" onClick={() => setDocuments([])}>清空列表</button>}</div><section className="document-list"><span className="decor list-decor-a">download archive</span><span className="decor list-decor-b">paper latte</span><span className="decor list-decor-c">quiet notes for brighter recall</span>{documents.length ? <div className="doc-list">{documents.map((doc) => <article className="doc-item" key={doc.id}><div><strong>{doc.title}</strong><span>{new Date(doc.createdAt).toLocaleString()} · {formatBytes(doc.size)}</span></div><button className="secondary" onClick={() => downloadBase64Docx(doc)}><Download size={16} />下载</button></article>)}</div> : <div className="empty-state illustrated"><FileText size={44} /><p className="prompt-hint">上传文件后，生成的复习重点将保存在这里</p></div>}</section></div>; }
function PracticeTab({ questions, currentIndex, currentQuestion, selectedForCurrent, selectedAnswers, progress, onSelect, onNext, onGenerateChoice, onGenerateEssay }) {
  if (!questions) return <section className="tab-panel practice-wrap"><div className="practice-empty"><PanelIntro title="开始练习" subtitle="生成 10 道单选题或 3 道大题后，在这里单题练习。" /><div className="practice-generate-row"><button className="primary" onClick={onGenerateChoice}>生成选择题</button><button className="primary" onClick={onGenerateEssay}>生成大题</button></div></div></section>;
  if (!currentQuestion) return <section className="tab-panel practice-wrap"><div className="practice-empty essay-practice"><PanelIntro title={questions.title} subtitle="大题练习" />{questions.essayQuestions?.length ? <div className="essay-list">{questions.essayQuestions.map((item, index) => <article className="essay-card" key={item.id}><strong>第 {index + 1} 题</strong><p>{item.question}</p>{item.referenceAnswer?.length ? <span>{item.referenceAnswer.join('；')}</span> : null}</article>)}</div> : <p className="prompt-hint">当前题组没有题目。</p>}<div className="practice-generate-row"><button className="primary" onClick={onGenerateChoice}>生成选择题</button><button className="primary" onClick={onGenerateEssay}>生成大题</button></div></div></section>;
  return <section className="tab-panel practice-wrap"><div className="practice-toolbar"><div><h1>{questions.title}</h1><p>单题模式 · 第 {currentIndex + 1} 题 / 共 {questions.choiceQuestions.length} 题</p></div></div><div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div><article className="single-question-card"><h2>{currentQuestion.question}</h2><div className="option-list">{currentQuestion.options.map((option) => <button key={option.label} className={`option-card ${selectedForCurrent === option.label ? 'selected' : ''}`} onClick={() => onSelect(option.label)}><span>{option.label}</span><strong>{option.text}</strong></button>)}</div><button className="primary next-button" onClick={onNext} disabled={!selectedAnswers[currentQuestion.id]}>下一题</button></article></section>;
}
function WrongBookTab({ batches, expandedBatches, setExpandedBatches }) { return <section className="tab-panel wrong-panel"><PanelIntro title="错题本" subtitle="按每次练习批次保存错题，方便回看当时的错误选项和解析" /><div className="batch-list">{batches.length ? batches.map((batch) => <article className="batch-card" key={batch.id}><button className="batch-summary" onClick={() => setExpandedBatches((c) => ({ ...c, [batch.id]: !c[batch.id] }))}><div><strong>{batch.sourceName}</strong><span>{new Date(batch.createdAt).toLocaleString()} · 错 {batch.wrongItems.length} 题 / 共 {batch.total} 题</span></div><ChevronDown className={expandedBatches[batch.id] ? 'open' : ''} size={18} /></button>{expandedBatches[batch.id] && <div className="batch-detail">{batch.wrongItems.map((item) => <article className="wrong-question" key={item.id}><div><strong>{item.question.question}</strong><span>你的答案：{item.selectedAnswer} · 正确答案：{item.correctAnswer}</span><p>{item.explanation}</p></div></article>)}</div>}</article>) : <div className="empty-state"><p>暂无错题批次</p></div>}</div></section>; }

function useLocalStorage(key, fallback) { const [value, setValue] = useState(() => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }); useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]); return [value, setValue]; }
function normalizeText(text = '') { return String(text).replace(/\s+/g, ' ').trim(); }
function limitForPrompt(text = '', max = 12000) { return text.length > max ? `${text.slice(0, max)}...` : text; }
function formatBytes(bytes = 0) { if (!bytes) return '0 B'; const units = ['B', 'KB', 'MB', 'GB']; const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`; }
function formatSummaryForPrompt(summary) { return `${summary.title}\n${summary.overview}\n${(summary.keyPoints || []).map((k) => `${k.heading}:${(k.details || []).join('；')}`).join('\n')}`; }
function extractJson(text = '') { const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('模型返回格式无效'); return JSON.parse(m[0]); }
async function requestJson(config, messages) { const res = await fetch('/api/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey.trim()}` }, body: JSON.stringify({ model: config.model || 'gpt-5.5', messages, baseUrl: config.baseUrl }) }); if (!res.ok) throw new Error(`请求失败：${res.status}`); const data = await res.json(); const content = data?.choices?.[0]?.message?.content || '{}'; return extractJson(content); }
function normalizeSummary(data, fallbackName) { return { title: data.title || fallbackName, overview: data.overview || '已生成复习重点', keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints : [] }; }
function normalizeQuestionSet(data, title, sourceName, kind) { const choiceQuestions = Array.isArray(data.choiceQuestions) ? data.choiceQuestions.slice(0, 10) : []; const essayQuestions = Array.isArray(data.essayQuestions) ? data.essayQuestions.slice(0, 3) : []; return { id: crypto.randomUUID(), title: data.title || title, sourceName, createdAt: new Date().toISOString(), choiceQuestions: kind === 'essay' ? [] : choiceQuestions.map((q, i) => ({ id: q.id || `c${i + 1}`, question: q.question || `第${i + 1}题`, options: q.options || [{ label: 'A', text: '选项A' }, { label: 'B', text: '选项B' }, { label: 'C', text: '选项C' }, { label: 'D', text: '选项D' }], answer: q.answer || 'A', explanation: q.explanation || '' })), essayQuestions: kind === 'choice' ? [] : essayQuestions.map((q, i) => ({ id: q.id || `e${i + 1}`, question: q.question || `大题${i + 1}`, referenceAnswer: q.referenceAnswer || [] })) }; }
async function extractText(file) { const ext = file.name.split('.').pop()?.toLowerCase(); if (ext === 'pdf') return extractPdfText(file); if (ext === 'docx') return extractDocxText(file); if (ext === 'pptx') return extractPptxText(file); throw new Error('仅支持 PDF / PPTX / DOCX'); }
async function extractPdfText(file) { const buffer = await file.arrayBuffer(); const pdf = await pdfjsLib.getDocument({ data: buffer }).promise; let txt = ''; for (let i = 1; i <= pdf.numPages; i += 1) { const page = await pdf.getPage(i); const content = await page.getTextContent(); txt += `\n${content.items.map((x) => x.str).join(' ')}`; } return txt; }
async function extractDocxText(file) { const buffer = await file.arrayBuffer(); const r = await mammoth.extractRawText({ arrayBuffer: buffer }); return r.value || ''; }
async function extractPptxText(file) { const zip = await JSZip.loadAsync(await file.arrayBuffer()); const parser = new XMLParser({ ignoreAttributes: false }); const names = Object.keys(zip.files).filter((n) => n.startsWith('ppt/slides/slide') && n.endsWith('.xml')); const texts = []; for (const name of names) { const xml = await zip.files[name].async('string'); const parsed = parser.parse(xml); const out = []; walkText(parsed, out); texts.push(out.join(' ')); } return texts.join('\n'); }
function walkText(node, out) { if (!node || typeof node !== 'object') return; for (const [k, v] of Object.entries(node)) { if (k === 'a:t' && typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((i) => walkText(i, out)); else walkText(v, out); } }
async function createStudyDocx(summary, sourceName) { const body = `${summary.title}\n\n${summary.overview}\n`; const content = btoa(unescape(encodeURIComponent(body))); return { id: crypto.randomUUID(), title: `${sourceName.replace(/\.[^.]+$/, '')}-复习重点.docx`, createdAt: new Date().toISOString(), size: body.length, content }; }
function downloadBase64Docx(doc) { const bytes = Uint8Array.from(atob(doc.content), (c) => c.charCodeAt(0)); const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = doc.title; a.click(); URL.revokeObjectURL(url); }

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
