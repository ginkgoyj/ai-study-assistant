import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { Upload, FileText, Settings, X, ChevronDown, ChevronUp, Trash2, CheckCircle, XCircle, Loader } from 'lucide-react';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// Utility functions
const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const truncateText = (text, maxLength) => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength);
};

// File parsing functions
const parsePDF = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    text += pageText + '\n';
  }
  return text;
};

const parseDOCX = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
};

const parsePPTX = async (file) => {
  const zip = await JSZip.loadAsync(file);
  const parser = new XMLParser({ ignoreAttributes: false });
  let text = '';
  
  const slideFiles = Object.keys(zip.files).filter(name => 
    name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
  );
  
  for (const slideName of slideFiles) {
    const slideXml = await zip.files[slideName].async('text');
    const parsed = parser.parse(slideXml);
    const extractText = (obj) => {
      if (typeof obj === 'string') return obj + ' ';
      if (typeof obj !== 'object' || obj === null) return '';
      let result = '';
      for (const key in obj) {
        if (key === 'a:t') result += obj[key] + ' ';
        else result += extractText(obj[key]);
      }
      return result;
    };
    text += extractText(parsed) + '\n';
  }
  
  return text;
};

const parseFile = async (file) => {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return await parsePDF(file);
  if (ext === 'docx') return await parseDOCX(file);
  if (ext === 'pptx') return await parsePPTX(file);
  throw new Error('不支持的文件格式');
};
// DOCX generation
const generateDOCX = (data) => {
  const zip = new JSZip();
  
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  let documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>`;

  const addParagraph = (text, bold = false, size = 24) => {
    return `<w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  };

  documentXml += addParagraph(data.title, true, 32);
  documentXml += addParagraph('');
  documentXml += addParagraph('总览', true, 28);
  documentXml += addParagraph(data.overview);
  documentXml += addParagraph('');

  if (data.keyPoints && data.keyPoints.length > 0) {
    documentXml += addParagraph('重点内容', true, 28);
    data.keyPoints.forEach(kp => {
      documentXml += addParagraph(kp.heading, true, 26);
      kp.details.forEach(detail => {
        documentXml += addParagraph('• ' + detail);
      });
    });
    documentXml += addParagraph('');
  }

  if (data.formulas && data.formulas.length > 0) {
    documentXml += addParagraph('重要公式', true, 28);
    data.formulas.forEach(formula => {
      documentXml += addParagraph(formula.name + ': ' + formula.expression, true);
      documentXml += addParagraph('适用场景: ' + formula.whenToUse);
    });
    documentXml += addParagraph('');
  }

  if (data.commonMistakes && data.commonMistakes.length > 0) {
    documentXml += addParagraph('常见易错点', true, 28);
    data.commonMistakes.forEach(mistake => {
      documentXml += addParagraph('• ' + mistake);
    });
    documentXml += addParagraph('');
  }

  if (data.reviewPlan && data.reviewPlan.length > 0) {
    documentXml += addParagraph('复习建议', true, 28);
    data.reviewPlan.forEach(plan => {
      documentXml += addParagraph('• ' + plan);
    });
  }

  documentXml += `</w:body></w:document>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('word/document.xml', documentXml);

  return zip.generateAsync({ type: 'blob' });
};
// API call function
const callAPI = async (config, prompt) => {
  const response = await fetch('/api/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetUrl: `${config.baseUrl}/chat/completions`,
      apiKey: config.apiKey,
      payload: {
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      }
    })
  });

  if (!response.ok) {
    if (response.status === 400) {
      const retryResponse = await fetch('/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: `${config.baseUrl}/chat/completions`,
          apiKey: config.apiKey,
          payload: {
            model: config.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3
          }
        })
      });
      
      if (!retryResponse.ok) throw new Error('API 调用失败');
      const retryData = await retryResponse.json();
      return JSON.parse(retryData.choices[0].message.content);
    }
    throw new Error('API 调用失败');
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
};

// Main App Component
function App() {
  const [activeTab, setActiveTab] = useState('upload');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notification, setNotification] = useState(null);
  const [toast, setToast] = useState(null);
  
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('study-helper-config-v1');
    return saved ? JSON.parse(saved) : {
      baseUrl: 'https://api.freemodel.dev/v1',
      model: 'gpt-5.5',
      apiKey: ''
    };
  });

  const [fileState, setFileState] = useState(null);
  const [documents, setDocuments] = useState(() => {
    const saved = localStorage.getItem('study-helper-documents-v1');
    return saved ? JSON.parse(saved) : [];
  });

  const [lastSet, setLastSet] = useState(() => {
    const saved = localStorage.getItem('study-helper-last-question-set-v1');
    return saved ? JSON.parse(saved) : null;
  });

  const [wrongBatches, setWrongBatches] = useState(() => {
    const saved = localStorage.getItem('study-helper-wrong-batches-v2');
    return saved ? JSON.parse(saved) : [];
  });

  const [practiceMode, setPracticeMode] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [practiceDone, setPracticeDone] = useState(false);
  const [expandedBatches, setExpandedBatches] = useState({});
  const [expandedAnswers, setExpandedAnswers] = useState({});
  const [status, setStatus] = useState('');

  const fileInputRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('study-helper-config-v1', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem('study-helper-documents-v1', JSON.stringify(documents));
  }, [documents]);

  useEffect(() => {
    if (lastSet) {
      localStorage.setItem('study-helper-last-question-set-v1', JSON.stringify(lastSet));
    }
  }, [lastSet]);

  useEffect(() => {
    localStorage.setItem('study-helper-wrong-batches-v2', JSON.stringify(wrongBatches));
  }, [wrongBatches]);

  const showNotification = (message) => {
    setNotification(message);
    setTimeout(() => setNotification(null), 5000);
  };

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 80 * 1024 * 1024) {
      showToast('文件大小超过 80MB 限制');
      return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'pptx'].includes(ext)) {
      showToast('不支持的文件格式，请使用 PDF、DOCX 或 PPTX');
      return;
    }

    setStatus('parsing');
    try {
      const text = await parseFile(file);
      setFileState({
        name: file.name,
        size: file.size,
        text: text,
        charCount: text.length
      });
      showNotification('文件上传成功');
      setStatus('');
    } catch (error) {
      showToast('文件解析失败: ' + error.message);
      setStatus('');
    }
  };

  const handleGenerateSummary = async () => {
    if (!fileState) {
      showNotification('请先上传文件');
      return;
    }

    if (!config.apiKey) {
      showNotification('请先在设置中配置 API Key');
      return;
    }

    setStatus('generating-summary');
    try {
      const text = truncateText(fileState.text, 28000);
      const prompt = `请分析以下学习资料，生成复习重点。返回 JSON 格式：
{
  "title": "资料标题",
  "overview": "150字以内总览",
  "keyPoints": [{"heading": "重点标题", "details": ["要点1", "要点2"]}],
  "formulas": [{"name": "公式名", "expression": "公式", "whenToUse": "适用场景"}],
  "commonMistakes": ["易错点1"],
  "reviewPlan": ["复习建议1"]
}

资料内容：
${text}`;

      const result = await callAPI(config, prompt);
      const blob = await generateDOCX(result);
      const url = URL.createObjectURL(blob);
      
      const newDoc = {
        id: crypto.randomUUID(),
        name: fileState.name.replace(/\.[^.]+$/, '') + '复习重点.docx',
        url: url,
        createdAt: new Date().toISOString()
      };

      setDocuments([...documents, newDoc]);
      showNotification('复习重点生成成功');
      setStatus('');
    } catch (error) {
      showToast('生成失败: ' + error.message);
      setStatus('');
    }
  };

  const handleClear = () => {
    setFileState(null);
    showNotification('已清空');
  };

  const handleGenerateQuestions = async (mode) => {
    if (!fileState) {
      showNotification('请先上传文件');
      return;
    }

    if (!config.apiKey) {
      showNotification('请先在设置中配置 API Key');
      return;
    }

    setStatus('generating-questions');
    try {
      const text = truncateText(fileState.text, 26000);
      const prompt = mode === 'choice' 
        ? `请根据以下学习资料生成 10 道单选题。返回 JSON 格式：
{
  "title": "题组标题",
  "choiceQuestions": [
    {
      "id": "c1",
      "question": "题干",
      "options": [
        {"label": "A", "text": "选项内容"},
        {"label": "B", "text": "选项内容"},
        {"label": "C", "text": "选项内容"},
        {"label": "D", "text": "选项内容"}
      ],
      "answer": "A",
      "explanation": "解析"
    }
  ]
}

资料内容：
${text}`
        : `请根据以下学习资料生成 3 道大题。返回 JSON 格式：
{
  "title": "题组标题",
  "essayQuestions": [
    {
      "id": "e1",
      "question": "大题题干",
      "referenceAnswer": ["参考答案要点1", "参考答案要点2"]
    }
  ]
}

资料内容：
${text}`;

      const result = await callAPI(config, prompt);
      setLastSet({
        ...result,
        sourceName: fileState.name,
        mode: mode
      });
      setPracticeMode(mode);
      setCurrentIndex(0);
      setSelectedAnswers({});
      setPracticeDone(false);
      setStatus('');
    } catch (error) {
      showToast('生成题目失败: ' + error.message);
      setStatus('');
    }
  };

  const handleSelectAnswer = (questionId, answer) => {
    setSelectedAnswers({ ...selectedAnswers, [questionId]: answer });
  };

  const handleNextQuestion = () => {
    if (currentIndex < lastSet.choiceQuestions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      handleFinishPractice();
    }
  };

  const handleFinishPractice = () => {
    setPracticeDone(true);
    
    const wrongItems = lastSet.choiceQuestions
      .filter(q => selectedAnswers[q.id] !== q.answer)
      .map(q => ({
        id: crypto.randomUUID(),
        question: q,
        selectedAnswer: selectedAnswers[q.id],
        correctAnswer: q.answer,
        explanation: q.explanation,
        wrongTimes: 1
      }));

    if (wrongItems.length > 0) {
      const batch = {
        id: crypto.randomUUID(),
        sourceName: lastSet.sourceName,
        title: lastSet.title,
        createdAt: new Date().toISOString(),
        total: lastSet.choiceQuestions.length,
        wrongCount: wrongItems.length,
        wrongItems: wrongItems
      };

      setWrongBatches([batch, ...wrongBatches]);
    }

    showNotification('练习完成');
  };

  const handleRetry = () => {
    setCurrentIndex(0);
    setSelectedAnswers({});
    setPracticeDone(false);
  };

  const handleMarkWrong = (questionId) => {
    const question = lastSet.essayQuestions.find(q => q.id === questionId);
    if (!question) return;

    const wrongItem = {
      id: crypto.randomUUID(),
      question: question,
      selectedAnswer: null,
      correctAnswer: null,
      explanation: question.referenceAnswer.join('\n'),
      wrongTimes: 1
    };

    const existingBatch = wrongBatches.find(b => 
      b.sourceName === lastSet.sourceName && 
      b.title === lastSet.title &&
      new Date(b.createdAt).toDateString() === new Date().toDateString()
    );

    if (existingBatch) {
      const updated = wrongBatches.map(b => {
        if (b.id === existingBatch.id) {
          const exists = b.wrongItems.find(item => item.question.id === questionId);
          if (exists) return b;
          return {
            ...b,
            wrongItems: [...b.wrongItems, wrongItem],
            wrongCount: b.wrongCount + 1
          };
        }
        return b;
      });
      setWrongBatches(updated);
    } else {
      const batch = {
        id: crypto.randomUUID(),
        sourceName: lastSet.sourceName,
        title: lastSet.title,
        createdAt: new Date().toISOString(),
        total: lastSet.essayQuestions.length,
        wrongCount: 1,
        wrongItems: [wrongItem]
      };
      setWrongBatches([batch, ...wrongBatches]);
    }

    showNotification('已添加到错题本');
  };

  const handleDeleteWrongItem = (batchId, itemId) => {
    const updated = wrongBatches.map(batch => {
      if (batch.id === batchId) {
        const newItems = batch.wrongItems.filter(item => item.id !== itemId);
        return {
          ...batch,
          wrongItems: newItems,
          wrongCount: newItems.length
        };
      }
      return batch;
    }).filter(batch => batch.wrongItems.length > 0);
    
    setWrongBatches(updated);
    showNotification('已删除');
  };

  const handleRetryWrongBatch = (batch) => {
    const choiceQuestions = batch.wrongItems
      .filter(item => item.question.options)
      .map(item => item.question);

    if (choiceQuestions.length > 0) {
      setLastSet({
        title: batch.title + ' - 错题重练',
        sourceName: batch.sourceName,
        choiceQuestions: choiceQuestions,
        mode: 'choice'
      });
      setPracticeMode('choice');
      setCurrentIndex(0);
      setSelectedAnswers({});
      setPracticeDone(false);
      setActiveTab('practice');
    }
  };
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (practiceMode !== 'choice' || practiceDone) return;
      
      const currentQ = lastSet?.choiceQuestions[currentIndex];
      if (!currentQ) return;

      if (['a', 'b', 'c', 'd'].includes(e.key.toLowerCase())) {
        const answer = e.key.toUpperCase();
        handleSelectAnswer(currentQ.id, answer);
      } else if (e.key === ' ' && selectedAnswers[currentQ.id]) {
        e.preventDefault();
        handleNextQuestion();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [practiceMode, practiceDone, currentIndex, lastSet, selectedAnswers]);

  return (
    <div className="app">
      <div className="top-bar">复习重点与错题练习</div>
      <h1 className="main-title">复习重点与错题练习</h1>
      
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          上传资料
        </button>
        <button 
          className={`tab ${activeTab === 'practice' ? 'active' : ''}`}
          onClick={() => setActiveTab('practice')}
        >
          开始练习
        </button>
        <button 
          className={`tab ${activeTab === 'wrong' ? 'active' : ''}`}
          onClick={() => setActiveTab('wrong')}
        >
          错题本
        </button>
      </div>

      {notification && (
        <div className="notification">
          {notification}
        </div>
      )}

      {toast && (
        <div className="toast">
          {toast}
        </div>
      )}

      <div className="content">
        {activeTab === 'upload' && (
          <>
            <div className="card">
              <div className="card-corner-text top-left">paper latte</div>
              <div className="card-corner-text bottom-right">study notes</div>
              
              {!fileState ? (
                <div className="card-center">
                  <Upload className="card-icon" size={48} />
                  <div className="card-text-primary">点击上传资料</div>
                  <div className="card-text-secondary">PDF / PPTX / DOCX, 单文件上限 80MB</div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.pptx"
                    onChange={handleFileUpload}
                  />
                  <button 
                    className="btn" 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={status === 'parsing'}
                  >
                    {status === 'parsing' ? (
                      <>
                        <Loader className="spinner" size={16} />
                        解析中...
                      </>
                    ) : (
                      <>
                        <Upload size={16} />
                        点击添加文件
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="file-info">
                  <div className="file-info-row">
                    <span className="file-info-label">文件名</span>
                    <span className="file-info-value">{fileState.name}</span>
                  </div>
                  <div className="file-info-row">
                    <span className="file-info-label">文件大小</span>
                    <span className="file-info-value">{formatFileSize(fileState.size)}</span>
                  </div>
                  <div className="file-info-row">
                    <span className="file-info-label">已提取字数</span>
                    <span className="file-info-value">{fileState.charCount} 字</span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: '32px' }}>
              <div className="section-title">生成文件列表</div>
              <div className="card">
                <div className="card-corner-text top-left">documents</div>
                <div className="card-corner-text bottom-right">archive</div>
                
                {documents.length === 0 ? (
                  <div className="card-center">
                    <FileText className="card-icon" size={48} />
                    <div className="card-text-secondary">
                      上传文件后，生成的复习重点将保存在这里
                    </div>
                  </div>
                ) : (
                  <div className="document-list">
                    {documents.map(doc => (
                      <div key={doc.id} className="document-item">
                        <span className="document-name">{doc.name}</span>
                        <a 
                          href={doc.url} 
                          download={doc.name}
                          className="btn-link"
                        >
                          下载
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="button-group">
              <button 
                className="btn" 
                onClick={handleGenerateSummary}
                disabled={!fileState || status === 'generating-summary'}
              >
                {status === 'generating-summary' ? (
                  <>
                    <Loader className="spinner" size={16} />
                    生成中...
                  </>
                ) : (
                  <>
                    <FileText size={16} />
                    生成复习重点.docx
                  </>
                )}
              </button>
              <button 
                className="btn" 
                onClick={handleClear}
                disabled={!fileState}
              >
                清空
              </button>
              <button 
                className="btn-icon" 
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={20} />
              </button>
            </div>
          </>
        )}

        {activeTab === 'practice' && (
          <>
            {!practiceMode && !lastSet && (
              <div className="empty-state">请先上传文件</div>
            )}

            {!practiceMode && lastSet && (
              <div className="practice-mode-select">
                <button 
                  className="mode-btn" 
                  onClick={() => handleGenerateQuestions('choice')}
                  disabled={status === 'generating-questions'}
                >
                  {status === 'generating-questions' ? (
                    <Loader className="spinner spinner-large" />
                  ) : (
                    <>
                      <CheckCircle className="mode-btn-icon" size={48} />
                      <span className="mode-btn-text">选择题</span>
                    </>
                  )}
                </button>
                <button 
                  className="mode-btn" 
                  onClick={() => handleGenerateQuestions('essay')}
                  disabled={status === 'generating-questions'}
                >
                  {status === 'generating-questions' ? (
                    <Loader className="spinner spinner-large" />
                  ) : (
                    <>
                      <FileText className="mode-btn-icon" size={48} />
                      <span className="mode-btn-text">大题</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {practiceMode === 'choice' && lastSet && !practiceDone && (
              <>
                {lastSet.choiceQuestions.map((q, idx) => {
                  if (idx !== currentIndex) return null;
                  
                  const selected = selectedAnswers[q.id];
                  const showResult = selected !== undefined;

                  return (
                    <div key={q.id} className="question-card">
                      <div className="question-header">
                        <span className="question-progress">
                          第 {currentIndex + 1} 题 / 共 {lastSet.choiceQuestions.length} 题
                        </span>
                      </div>
                      
                      <div className="progress-bar">
                        <div 
                          className="progress-fill" 
                          style={{ width: `${((currentIndex + 1) / lastSet.choiceQuestions.length) * 100}%` }}
                        />
                      </div>

                      <div className="question-text">{q.question}</div>

                      <div className="options">
                        {q.options.map(opt => {
                          let className = 'option';
                          if (showResult) {
                            if (opt.label === q.answer) className += ' correct';
                            else if (opt.label === selected) className += ' wrong';
                          } else if (opt.label === selected) {
                            className += ' selected';
                          }

                          return (
                            <div
                              key={opt.label}
                              className={className}
                              onClick={() => !showResult && handleSelectAnswer(q.id, opt.label)}
                            >
                              <span className="option-label">{opt.label}</span>
                              <span className="option-text">{opt.text}</span>
                              {showResult && opt.label === q.answer && (
                                <CheckCircle size={20} style={{ color: '#7C9473', marginLeft: 'auto' }} />
                              )}
                              {showResult && opt.label === selected && opt.label !== q.answer && (
                                <XCircle size={20} style={{ color: '#B87C7C', marginLeft: 'auto' }} />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {showResult && (
                        <div className="explanation">
                          <div className="explanation-title">解析</div>
                          <div className="explanation-text">{q.explanation}</div>
                        </div>
                      )}

                      {selected && (
                        <div className="button-group">
                          <button className="btn" onClick={handleNextQuestion}>
                            {currentIndex < lastSet.choiceQuestions.length - 1 ? '下一题' : '完成练习'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {practiceMode === 'choice' && practiceDone && (
              <>
                <div className="results-summary">
                  <div className="results-score">
                    {lastSet.choiceQuestions.filter(q => selectedAnswers[q.id] === q.answer).length} / {lastSet.choiceQuestions.length}
                  </div>
                  <div className="results-text">
                    正确 {lastSet.choiceQuestions.filter(q => selectedAnswers[q.id] === q.answer).length} 题，
                    错误 {lastSet.choiceQuestions.filter(q => selectedAnswers[q.id] !== q.answer).length} 题
                  </div>
                  <div className="results-actions">
                    <button className="btn" onClick={handleRetry}>再练一遍</button>
                    <button className="btn" onClick={() => { setPracticeMode(null); setLastSet(null); }}>
                      生成新题
                    </button>
                  </div>
                </div>

                {lastSet.choiceQuestions.map(q => {
                  const selected = selectedAnswers[q.id];

                  return (
                    <div key={q.id} className="question-card">
                      <div className="question-text">{q.question}</div>
                      <div className="options">
                        {q.options.map(opt => {
                          let className = 'option';
                          if (opt.label === q.answer) className += ' correct';
                          else if (opt.label === selected) className += ' wrong';

                          return (
                            <div key={opt.label} className={className}>
                              <span className="option-label">{opt.label}</span>
                              <span className="option-text">{opt.text}</span>
                              {opt.label === q.answer && (
                                <CheckCircle size={20} style={{ color: '#7C9473', marginLeft: 'auto' }} />
                              )}
                              {opt.label === selected && opt.label !== q.answer && (
                                <XCircle size={20} style={{ color: '#B87C7C', marginLeft: 'auto' }} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="explanation">
                        <div className="explanation-title">解析</div>
                        <div className="explanation-text">{q.explanation}</div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {practiceMode === 'essay' && lastSet && (
              <>
                {lastSet.essayQuestions.map(q => (
                  <div key={q.id} className="essay-question">
                    <div className="essay-question-text">{q.question}</div>
                    
                    <div className="reference-answer">
                      <button 
                        className="reference-toggle"
                        onClick={() => setExpandedAnswers({
                          ...expandedAnswers,
                          [q.id]: !expandedAnswers[q.id]
                        })}
                      >
                        {expandedAnswers[q.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        参考答案
                      </button>
                      
                      {expandedAnswers[q.id] && (
                        <div className="reference-content">
                          <ul>
                            {q.referenceAnswer.map((ans, idx) => (
                              <li key={idx}>{ans}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="essay-actions">
                      <button 
                        className="btn btn-small" 
                        onClick={() => handleMarkWrong(q.id)}
                      >
                        标记为错题
                      </button>
                    </div>
                  </div>
                ))}

                <div className="button-group">
                  <button className="btn" onClick={() => { setPracticeMode(null); setLastSet(null); }}>
                    生成新题
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {activeTab === 'wrong' && (
          <>
            {wrongBatches.length === 0 ? (
              <div className="empty-state">暂无错题记录</div>
            ) : (
              <>
                {wrongBatches.map(batch => (
                  <div key={batch.id} className="wrong-batch-card">
                    <div 
                      className="wrong-batch-header"
                      onClick={() => setExpandedBatches({
                        ...expandedBatches,
                        [batch.id]: !expandedBatches[batch.id]
                      })}
                    >
                      <div className="wrong-batch-info">
                        <div className="wrong-batch-title">{batch.title}</div>
                        <div className="wrong-batch-meta">
                          {batch.sourceName} · {new Date(batch.createdAt).toLocaleDateString()} · 
                          错 {batch.wrongCount} 题 / 共 {batch.total} 题
                        </div>
                      </div>
                      <div className="wrong-batch-expand">
                        {expandedBatches[batch.id] ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </div>
                    </div>

                    {expandedBatches[batch.id] && (
                      <div className="wrong-batch-details">
                        {batch.wrongItems.map(item => (
                          <div key={item.id} className="wrong-item">
                            <button
                              className="wrong-item-delete"
                              onClick={() => handleDeleteWrongItem(batch.id, item.id)}
                            >
                              <Trash2 size={16} />
                            </button>

                            <div className="wrong-item-question">{item.question.question}</div>

                            {item.question.options && (
                              <>
                                <div className="wrong-item-answer">
                                  <span className="wrong-item-label">你的答案：</span>
                                  <span className="wrong-item-value wrong">{item.selectedAnswer}</span>
                                </div>
                                <div className="wrong-item-answer">
                                  <span className="wrong-item-label">正确答案：</span>
                                  <span className="wrong-item-value correct">{item.correctAnswer}</span>
                                </div>
                              </>
                            )}

                            <div className="explanation">
                              <div className="explanation-title">解析</div>
                              <div className="explanation-text">{item.explanation}</div>
                            </div>

                            {item.wrongTimes > 1 && (
                              <div className="wrong-item-answer">
                                <span className="wrong-item-label">错误次数：</span>
                                <span className="wrong-item-value">{item.wrongTimes}</span>
                              </div>
                            )}
                          </div>
                        ))}

                        <div className="button-group">
                          <button 
                            className="btn" 
                            onClick={() => handleRetryWrongBatch(batch)}
                          >
                            重新练习本批错题
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      <div className={`settings-sidebar ${settingsOpen ? 'open' : ''}`}>
        <div className="settings-header">
          <h2 className="settings-title">设置</h2>
          <button className="btn-icon" onClick={() => setSettingsOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <div className="form-group">
          <label className="form-label">API Base URL</label>
          <input
            type="text"
            className="form-input"
            value={config.baseUrl}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
            placeholder="https://api.freemodel.dev/v1"
          />
        </div>

        <div className="form-group">
          <label className="form-label">模型名</label>
          <input
            type="text"
            className="form-input"
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
            placeholder="gpt-5.5"
          />
        </div>

        <div className="form-group">
          <label className="form-label">API Key</label>
          <input
            type="password"
            className="form-input"
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            placeholder="输入你的 API Key"
          />
        </div>

        <button 
          className="btn" 
          onClick={() => {
            setSettingsOpen(false);
            showNotification('设置已保存');
          }}
        >
          保存设置
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
