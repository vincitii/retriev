import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import { claudeComplete } from './anthropicClient';
import {
  buildStudySchedule,
  computeNextReviewDate,
  countDaysBetween,
  extractTextFromPdf,
  formatDate,
  getTodayKey,
  loadAppState,
  parseSimpleCourses,
  saveAppState,
  safeParseJson,
  formatDateWithDay,
  formatTime12,
} from './helpers';

const initialState = {
  contentItems: [],
  requiredCourses: [],
  exams: [],
  courses: [],
  schedule: [],
  history: [],
  userName: null,
  theme: 'dark',
  availability: { wake: '07:00', sleep: '23:00', blocked: [] },
};

const ratingLabels = [
  { label: 'Easy', value: 'easy', color: 'green' },
  { label: 'Good', value: 'good', color: 'blue' },
  { label: 'Hard', value: 'hard', color: 'orange' },
  { label: 'Missed', value: 'missed', color: 'red' },
  { label: 'Guessed', value: 'guessed', color: 'goldenrod' },
];

function OnboardForm({ onSave }) {
  const [name, setName] = useState('');
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onSave(name)}>Save</button>
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState(() => loadAppState() || initialState);
  const [uploadMessage, setUploadMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [courseDraft, setCourseDraft] = useState('');
  const [examName, setExamName] = useState('Final exam');
  const [examDate, setExamDate] = useState('');
  const [examChapters, setExamChapters] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [reviewCourseId, setReviewCourseId] = useState('');
  const [customExample, setCustomExample] = useState('');
  const [customAnalogy, setCustomAnalogy] = useState('');
  const [teachBack, setTeachBack] = useState('');
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState(state.theme || 'dark');

  const [timerState, setTimerState] = useState({ sessionId: null, remaining: 0, running: false });
  const [availability, setAvailability] = useState(state.availability || { wake: '07:00', sleep: '23:00', blocked: [] });
  const [showSettings, setShowSettings] = useState(false);
  const [recommendation, setRecommendation] = useState('');

  useEffect(() => {
    saveAppState({ ...state, availability });
  }, [state, availability]);

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem('paStudyAppTheme');
      if (savedTheme) setTheme(savedTheme);
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('paStudyAppTheme', theme);
    } catch (e) {
      // ignore
    }
    document.body.classList.toggle('theme-light', theme === 'light');
    document.body.classList.toggle('theme-dark', theme === 'dark');
  }, [theme]);

  const weekDates = useMemo(() => {
    const today = new Date();
    const days = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date();
      d.setDate(today.getDate() + i);
      days.push({ key: d.toISOString().slice(0, 10), date: d });
    }
    return days;
  }, []);

  const todayKey = getTodayKey();

  const dueCourses = useMemo(() => {
    return state.courses
      .filter((course) => course.nextDue && course.nextDue <= todayKey)
      .sort((a, b) => (a.nextDue === b.nextDue ? b.stats.missed - a.stats.missed : a.nextDue.localeCompare(b.nextDue)));
  }, [state.courses, todayKey]);

  useEffect(() => {
    // compute simple recommendation: hours needed today based on days to next exam and number of courses
    if (!state.exams.length || !state.courses.length) return setRecommendation('');
    const nextExam = state.exams.map(e=>({...e,date:new Date(e.date)})).filter(e=>e.date>=new Date()).sort((a,b)=>a.date-b.date)[0];
    if (!nextExam) return setRecommendation('');
    const days = countDaysBetween(new Date(), nextExam.date) || 1;
    const baseHours = Math.ceil((state.courses.length * 1) / Math.max(1, days));
    setRecommendation(`You should study at least ${baseHours} hour${baseHours>1?'s':''} today to stay on track for ${formatDate(nextExam.date)}`);
  }, [state.exams, state.courses]);

  const selectedCourse = useMemo(() => {
    return state.courses.find((c) => c.id === selectedCourseId) || state.courses[0] || null;
  }, [selectedCourseId, state.courses]);

  const reviewCourse = useMemo(() => {
    return state.courses.find((c) => c.id === reviewCourseId) || dueCourses[0] || null;
  }, [reviewCourseId, dueCourses, state.courses]);

  const weakCourses = useMemo(() => {
    return state.courses
      .filter((c) => (c.stats.missed || 0) + (c.stats.guessed || 0) >= 2)
      .sort((a, b) => (b.stats.missed || 0) - (a.stats.missed || 0));
  }, [state.courses]);

  const weeklyReport = useMemo(() => {
    const mastered = state.courses.filter((c) => c.stats.easy >= 3 && c.stats.totalReviews >= 4).length;
    const needsWork = state.courses.filter((c) => c.stats.missed + c.stats.guessed >= 2).length;
    return { mastered, needsWork, total: state.courses.length };
  }, [state.courses]);

  const completedToday = useMemo(() => state.history.filter((h) => h.date && h.date.slice(0, 10) === todayKey).length, [state.history, todayKey]);
  const todayTotal = dueCourses.length || 1;
  const progressPercent = Math.round((completedToday / todayTotal) * 100);

  const streak = useMemo(() => {
    const days = Array.from(new Set((state.history || []).map((h) => h.date && h.date.slice(0, 10))).values()).filter(Boolean).sort().reverse();
    if (!days.length) return 0;
    let count = 0;
    for (let i = 0; i < days.length; i++) {
      const d = new Date(days[i]);
      const diff = Math.round((new Date().setHours(0,0,0,0) - d.setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
      if (diff === i) count += 1; else break;
    }
    return count;
  }, [state.history]);

  function updateAppState(changes) {
    setState((prev) => ({ ...prev, ...changes }));
  }

  function saveUserName(name) {
    if (!name) return;
    updateAppState({ userName: name });
    try { window.localStorage.setItem('paStudyAppUserName', name); } catch (e) {}
    setStatusMessage(`Welcome, ${name}`);
  }

  async function handleFileUpload(event) {
    const files = Array.from(event.target.files || []);

    if (!files.length) return;
    setUploadMessage('Importing files...');
    setLoading(true);

    const promiseTimeout = (promise, ms, message) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then((value) => {
        clearTimeout(timer);
        resolve(value);
      }).catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    try {
      const newItems = [];

      for (const file of files) {
        if (file.size > 40 * 1024 * 1024) {
          throw new Error('File is too large. Please upload a smaller PDF or split it into sections.');
        }

        let text = '';
        if (file.name.toLowerCase().endsWith('.pdf')) {
          text = await promiseTimeout(
            extractTextFromPdf(file),
            30000,
            'PDF parsing timeout. Try again with a smaller file or fewer pages.'
          );
        } else {
          text = await promiseTimeout(file.text(), 15000, 'Text extraction timeout. Please try a smaller file.');
        }

        newItems.push({
          id: `${file.name}-${Date.now()}`,
          name: file.name,
          type: file.type || 'text/plain',
          text,
          importedAt: new Date().toISOString(),
        });
      }

      updateAppState({ contentItems: [...state.contentItems, ...newItems] });
      setUploadMessage(`Imported ${newItems.length} file(s). Ready to extract courses.`);
    } catch (error) {
      console.error(error);
      setUploadMessage(error.message || 'Upload failed. Try again with PDF or text files.');
    } finally {
      setLoading(false);
    }
  }

  async function handleParseContent() {
    if (!state.contentItems.length) {
      setStatusMessage('Upload notes or slides first.');
      return;
    }

    setStatusMessage('Extracting high-yield courses from your uploads...');
    setLoading(true);

    try {
      const combinedText = state.contentItems.map((item) => `${item.name}\n${item.text}`).join('\n\n');
      const prompt = `You are a PA school study coach. The user uploads course materials and needs key course headings prioritized for PA exam preparation. Extract 8-10 concise, high-yield course titles with a one-sentence justification and 3 key concept bullets for each course. Return only valid JSON in this format: [{"title":"...","chapter":"...","reason":"...","keyConcepts":["...","...","..."]}].`; 
      const result = await claudeComplete(prompt, 600);
      let parsed = safeParseJson(result);

      if (!Array.isArray(parsed) || !parsed.length) {
        parsed = parseSimpleCourses(combinedText);
      }

      const palette = ['#0b3b5a','#0f4c81','#2a6f97','#1f6fb2','#ff8c42','#ffb86b','#6c5ce7','#00a8e8'];
      const newCourses = parsed.map((item, index) => ({
        id: `course-${Date.now()}-${index}`,
        title: item.title || item.titleText || `Course ${index + 1}`,
        chapter: item.chapter || item.chapterName || '',
        source: 'Content parse',
        reason: item.reason || item.summary || '',
        keyConcepts: item.keyConcepts || (item.concepts ? item.concepts.slice(0, 3) : []),
        color: palette[index % palette.length],
        assets: {
          practiceQuestion: '',
          answerExplanation: '',
          clinicalExample: '',
          mnemonic: '',
          videoSuggestions: '',
          conceptMap: '',
          summary: '',
          analogy: '',
          dualCoding: '',
        },
        stats: { easy: 0, good: 0, hard: 0, missed: 0, guessed: 0, totalReviews: 0 },
        nextDue: todayKey,
        confidenceHistory: [],
        createdAt: new Date().toISOString(),
      }));

      updateAppState({ courses: [...state.courses, ...newCourses] });
      setStatusMessage(`Created ${newCourses.length} courses. Start reviewing today.`);
    } catch (error) {
      console.error(error);
      setStatusMessage('Failed to parse content. If you have an API key, check .env and try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleAddCourse(event) {
    event.preventDefault();
    const title = courseDraft.trim();
    if (!title) return;
    const palette = ['#0b3b5a','#0f4c81','#2a6f97','#1f6fb2','#ff8c42','#ffb86b','#6c5ce7','#00a8e8'];
    const newCourse = {
      id: `course-manual-${Date.now()}`,
      title,
      chapter: '',
      source: 'Manual course',
      reason: 'Required exam course',
      keyConcepts: [],
      color: palette[state.courses.length % palette.length],
      assets: {
        practiceQuestion: '',
        answerExplanation: '',
        clinicalExample: '',
        mnemonic: '',
        videoSuggestions: '',
        conceptMap: '',
        summary: '',
        analogy: '',
        dualCoding: '',
      },
      stats: { easy: 0, good: 0, hard: 0, missed: 0, guessed: 0, totalReviews: 0 },
      nextDue: todayKey,
      confidenceHistory: [],
      createdAt: new Date().toISOString(),
    };

    updateAppState({ courses: [...state.courses, newCourse] });
    setCourseDraft('');
  }

  function handleAddExam(event) {
    event.preventDefault();
    if (!examDate || !examName) return;
    const newExam = {
      id: `exam-${Date.now()}`,
      name: examName.trim() || 'Exam',
      date: examDate,
      chapters: examChapters.trim(),
    };
    updateAppState({ exams: [...state.exams, newExam] });
    setExamName('');
    setExamDate('');
    setExamChapters('');
  }

  async function handleGenerateSchedule() {
    if (!state.exams.length || !state.courses.length) {
      setStatusMessage('Add both exam plans and courses before generating a schedule.');
      return;
    }
    const schedule = buildStudySchedule(state.exams, state.courses, availability);
    updateAppState({ schedule });
    setStatusMessage(`Built ${schedule.length} study sessions through your next exam.`);
  }

  function handleDeleteCourse(id) {
    updateAppState({ courses: state.courses.filter((c) => c.id !== id) });
    if (selectedCourseId === id) setSelectedCourseId('');
    if (reviewCourseId === id) setReviewCourseId('');
  }

  function handleRemoveContent(id) {
    updateAppState({ contentItems: state.contentItems.filter((c) => c.id !== id) });
  }

  async function handleGenerateCourseAssets(courseId) {
    const course = state.courses.find((item) => item.id === courseId);
    if (!course) return;
    setLoading(true);
    setStatusMessage(`Generating active recall materials for ${course.title}...`);

    try {
      const prompt = `You are a PA school study coach building a spaced-repetition study card for the course "${course.title}". Produce a JSON object with these fields: practiceQuestion, answerExplanation, clinicalExample, mnemonic, videoSuggestions, conceptMap, summary, analogy, dualCoding. Keep each field concise and concrete. Use a clinical PA-school tone. Required format: {"practiceQuestion":"...","answerExplanation":"...","clinicalExample":"...","mnemonic":"...","videoSuggestions":"...","conceptMap":"...","summary":"...","analogy":"...","dualCoding":"..."}`;
      const result = await claudeComplete(prompt, 900);
      const parsed = safeParseJson(result);

      if (!parsed) {
        throw new Error('Unable to parse assets from Claude response.');
      }

      const updatedCourses = state.courses.map((item) =>
        item.id === courseId
          ? { ...item, assets: { ...item.assets, ...parsed } }
          : item
      );
      updateAppState({ courses: updatedCourses });
      setStatusMessage(`Assets generated for ${course.title}. Use them during review.`);
    } catch (error) {
      console.error(error);
      setStatusMessage('Unable to generate course assets. Confirm the API key and try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleRateCourse(courseId, rating) {
    const course = state.courses.find((item) => item.id === courseId);
    if (!course) return;

    const nextDue = computeNextReviewDate(rating, state.exams);
    const updatedCourse = {
      ...course,
      nextDue,
      stats: {
        ...course.stats,
        [rating]: (course.stats[rating] || 0) + 1,
        totalReviews: (course.stats.totalReviews || 0) + 1,
      },
      confidenceHistory: [
        ...(course.confidenceHistory || []),
        { date: todayKey, rating },
      ],
      userExample: customExample || course.userExample,
      userAnalogy: customAnalogy || course.userAnalogy,
      teachBacks: [...(course.teachBacks || []), teachBack].filter(Boolean),
    };

    updateAppState({
      courses: state.courses.map((item) => (item.id === courseId ? updatedCourse : item)),
      history: [
        {
          id: `history-${Date.now()}`,
          courseId,
          title: course.title,
          date: new Date().toISOString(),
          rating,
        },
        ...state.history,
      ],
    });

    setCustomExample('');
    setCustomAnalogy('');
    setTeachBack('');
    setStatusMessage(`Updated review schedule for ${course.title}. Next due ${nextDue}.`);
  }

  function handleSelectCourse(courseId) {
    setSelectedCourseId(courseId);
    setReviewCourseId(courseId);
  }

  function toggleTheme() {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem('paStudyAppTheme', next); } catch (e) {}
      return next;
    });
  }

  function startSessionTimer(sessionId) {
    setTimerState({ sessionId, remaining: 90 * 60, running: true });
  }

  function stopSessionTimer() {
    setTimerState({ sessionId: null, remaining: 0, running: false });
  }

  useEffect(() => {
    if (!timerState.running) return undefined;
    const id = setInterval(() => {
      setTimerState((s) => {
        if (!s.running) return s;
        if (s.remaining <= 1) {
          clearInterval(id);
          window.alert('Study session complete — take a break!');
          return { sessionId: null, remaining: 0, running: false };
        }
        return { ...s, remaining: s.remaining - 1 };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerState.running]);

  if (!state.userName) {
    return (
      <div className="app-shell">
        <section className="panel">
          <h2>Welcome — let's get started</h2>
          <p>What's your first name? We'll use it to personalize your study experience.</p>
          <OnboardForm onSave={saveUserName} />
        </section>
      </div>
    );
  }

  return (
    <div className={`app-shell theme-${theme}`}>
      <header className="hero">
        <div className="hero-brand">
          <div className="brand-block">
            <span className="brand-icon">🧠</span>
            <span className="brand-name">RETRIEV</span>
          </div>
          <p className="hero-greeting">{state.userName ? `Good morning, ${state.userName}` : 'Welcome to Retriev'}</p>
          <p className="subtitle">Spaced retrieval, interleaving, and exam-ready practice.</p>
        </div>
        <div className="status-bar">
          <div className="progress-wrap">
            <div className="progress-label">Today: {completedToday}/{dueCourses.length || 0} completed</div>
            <div className="progress-bar"><div className="progress-fill" style={{ width: `${progressPercent}%` }} /></div>
          </div>
          <div className="meta-chips">
            <span className="chip">{state.courses.length} courses</span>
            <span className="chip">{state.exams.length} exams</span>
            <span className="chip">{dueCourses.length} due today</span>
            <span className="chip">🔥 {streak} day streak</span>
            {timerState.running ? (
              <span className="chip">⏱ {Math.floor(timerState.remaining/60)}:{String(timerState.remaining%60).padStart(2,'0')}</span>
            ) : null}
            {timerState.running ? (
              <button className="secondary" onClick={stopSessionTimer}>Stop timer</button>
            ) : null}
            <button className="theme-toggle" onClick={toggleTheme}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
          </div>
        </div>
      </header>

      <main>
        <section className="panel-grid top-grid">
          <section className="panel panel-small study-queue">
            <h2>Study queue due today</h2>
            {dueCourses.length ? (
              dueCourses.map((course) => (
                <button
                  type="button"
                  key={course.id}
                  className={`course-link ${reviewCourse?.id === course.id ? 'active' : ''}`}
                  onClick={() => handleSelectCourse(course.id)}
                  style={{ borderLeft: `4px solid ${course.color || '#2055b1'}` }}
                >
                  <strong>{course.title}</strong>
                  <span>Due {formatDate(course.nextDue)}</span>
                </button>
              ))
            ) : (
              <p>No items due today. Generate schedule or add courses to start your review queue.</p>
            )}
            <div className="subsection-group">
              <div className="report-card report-sub">
                <strong>Weekly report</strong>
                <p>{weeklyReport.mastered} mastered</p>
                <p>{weeklyReport.needsWork} need more work</p>
                <p>{weeklyReport.total} total courses</p>
              </div>
              <div className="report-card report-sub">
                <strong>Weak spot tracker</strong>
                {weakCourses.length ? weakCourses.slice(0, 3).map((c) => (
                  <p key={c.id}><span style={{ color: c.color }}>{c.title}</span> — {c.stats.missed || 0} missed</p>
                )) : <p>No consistent weak spots yet.</p>}
              </div>
            </div>
          </section>

          <section className="panel panel-large panel-compact">
            <div className="panel-heading-row">
              <div>
                <h2>{reviewCourse ? reviewCourse.title : 'Select a course to review'}</h2>
                {reviewCourse && <p className="microcopy">{reviewCourse.reason || 'Use this card for active recall and spaced repetition.'}</p>}
              </div>
              {reviewCourse && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="secondary" onClick={() => handleGenerateCourseAssets(reviewCourse.id)} disabled={loading}>
                    Generate Study Assets
                  </button>
                </div>
              )}
            </div>

            {reviewCourse ? (
              <div className="study-card">
                <h3 style={{ marginTop: 12 }}>{reviewCourse.title}</h3>
                <p className="microcopy">{reviewCourse.reason}</p>
                <div className="rating-group">
                  {ratingLabels.map((rating) => (
                    <button key={rating.value} type="button" className={`rating-${rating.value}`} onClick={() => handleRateCourse(reviewCourse.id, rating.value)}>
                      {rating.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </section>

        <section className="panel-grid panel-grid-spacious">
          <section className="panel panel-large upload-panel">
            <h2>Upload notes, slides, and textbooks</h2>
            <p>Import lecture slides (PDF) or plain text and let the app extract high-yield PA courses automatically.</p>
            <input type="file" accept=".pdf,.txt" multiple onChange={handleFileUpload} disabled={loading} />
            <button type="button" onClick={handleParseContent} disabled={loading || !state.contentItems.length}>
              Extract key concepts with Claude
            </button>
            <p className="microcopy">{uploadMessage || statusMessage}</p>
            <div className="content-list">
              {state.contentItems.map((item) => (
                <article key={item.id} className="content-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{item.name}</strong>
                    <button type="button" className="secondary" onClick={() => handleRemoveContent(item.id)} title="Remove file">✖</button>
                  </div>
                  <div className="chip">{item.type || 'text'}</div>
                  <p>{item.text.slice(0, 180)}{item.text.length > 180 ? '…' : ''}</p>
                </article>
              ))}
              {state.contentItems.length===0 && <div className="microcopy">No uploaded notes</div>}
            </div>
          </section>

          <section className="panel panel-small">
            <h2>Exam schedule & required courses</h2>
            <form onSubmit={handleAddExam} className="stacked-form">
              <label>
                Exam name
                <input value={examName} onChange={(e) => setExamName(e.target.value)} placeholder="Example: Pharm final" />
              </label>
              <label>
                Exam date
                <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
              </label>
              <label>
                Required courses or chapters
                <input value={examChapters} onChange={(e) => setExamChapters(e.target.value)} placeholder="Anatomy, Physiology, Pharmacology" />
              </label>
              <button type="submit">Save exam plan</button>
            </form>
            <div className="chip-list">
              {state.exams.map((exam) => (
                <div key={exam.id} className="chip card-chip">
                  <strong>{exam.name}</strong>
                  <span>{formatDate(exam.date)}</span>
                  <span>{exam.chapters}</span>
                </div>
              ))}
            </div>
            <button type="button" className="secondary" onClick={handleGenerateSchedule} disabled={!state.exams.length || !state.courses.length}>
              Generate daily study schedule
            </button>
          </section>
        </section>

        <section className="panel-grid panel-grid-spacious">
          <section className="panel panel-large right-column-large">
            <h2>Course lab</h2>
            <form onSubmit={handleAddCourse} className="add-course-form">
              <label>
                Add a required PA course
                <input
                  value={courseDraft}
                  onChange={(e) => setCourseDraft(e.target.value)}
                  placeholder="State management of acute asthma, renal physiology, drug pharmacokinetics"
                />
              </label>
              <button type="submit">Add course</button>
            </form>
            <div className="course-list">
              {state.courses.map((course) => (
                <article key={course.id} className={`course-card ${selectedCourse?.id === course.id ? 'course-card-selected' : ''}`} style={{ borderLeft: `4px solid ${course.color || '#2055b1'}` }}>
                  <div style={{ cursor: 'pointer' }} onClick={() => handleSelectCourse(course.id)}>
                    <strong>{course.title}</strong>
                    <p>{course.source}</p>
                  </div>
                  <div className="stats">
                    <span>{course.nextDue ? `Due ${formatDate(course.nextDue)}` : 'Not scheduled'}</span>
                    <span>{course.stats.totalReviews || 0} reviews</span>
                    <button type="button" className="secondary" onClick={() => handleDeleteCourse(course.id)} title="Delete course">🗑</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel panel-small study-schedule-side">
            <h2>Study schedule</h2>
            <p>Each session is built as a 90-minute focused block with integrated breaks and a mix of related courses.</p>
            <div className="schedule-list">
              {state.schedule.length ? state.schedule.map((session) => (
                <article key={session.id} className="schedule-card">
                  <div className="schedule-header">
                    <strong>{formatDateWithDay(session.date)}</strong>
                    <span>{formatTime12(session.start)} - {formatTime12(session.end)}</span>
                  </div>
                  <p>{session.summary}</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div className="chip-list">
                      {session.courses.map((courseTitle) => {
                        const c = state.courses.find((x) => x.title === courseTitle) || {};
                        const border = '4px solid ' + (c.color || '#2055b1');
                        return (<span key={courseTitle} className="chip" style={{ borderLeft: border }}>{courseTitle}</span>);
                      })}
                    </div>
                    <div>
                      <button onClick={() => startSessionTimer(session.id)}>Start 90-min timer</button>
                    </div>
                  </div>
                </article>
              )) : <p>No schedule generated yet. Add exams and courses, then generate a study plan.</p>}
            </div>
            <div className="timer-ui">
              {timerState.running ? <div>Time left: {Math.floor(timerState.remaining/60)}:{String(timerState.remaining%60).padStart(2,'0')}</div> : null}
            </div>
          </section>
        </section>

        {/* Settings and availability panel */}
        <section className="panel-grid panel-grid-spacious">
          <section className="panel panel-large">
            <h2>My schedule</h2>
            <p className="microcopy">Set your daily availability so study sessions are scheduled only when you're free.</p>
            <div style={{ display: 'grid', gap: 12 }}>
              <label>
                Wake time
                <input type="time" value={availability.wake} onChange={(e) => setAvailability((s)=>({...s,wake:e.target.value}))} />
              </label>
              <label>
                Sleep time
                <input type="time" value={availability.sleep} onChange={(e) => setAvailability((s)=>({...s,sleep:e.target.value}))} />
              </label>
              <div>
                <strong>Blocked slots</strong>
                {availability.blocked && availability.blocked.length ? (
                  <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                    {availability.blocked.map((b, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>{b.label || 'Blocked'}</div>
                        <div style={{ width: 120 }}>{b.start} — {b.end}</div>
                        <button type="button" className="secondary" onClick={() => { setAvailability((s)=>({...s,blocked:s.blocked.filter((_,i)=>i!==idx)})); }}>Remove</button>
                      </div>
                    ))}
                  </div>
                ) : <p className="microcopy">No blocked slots</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input placeholder="Label (e.g., Class)" id="newBlockLabel" />
                  <input type="time" id="newBlockStart" />
                  <input type="time" id="newBlockEnd" />
                  <button type="button" onClick={() => {
                    const label = document.getElementById('newBlockLabel').value || 'Blocked';
                    const start = document.getElementById('newBlockStart').value;
                    const end = document.getElementById('newBlockEnd').value;
                    if (!start || !end) return alert('Pick start and end');
                    setAvailability((s)=>({...s, blocked:[...(s.blocked||[]), { label, start, end }]}));
                    document.getElementById('newBlockLabel').value='';
                    document.getElementById('newBlockStart').value='';
                    document.getElementById('newBlockEnd').value='';
                  }}>Add</button>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                  <button type="button" onClick={() => { setShowSettings(!showSettings); }}>Settings</button>
                {showSettings ? (
                  <div style={{ marginTop: 12 }}>
                    <button type="button" className="secondary" onClick={() => {
                      if (!window.confirm('Are you sure you want to reset all data? This cannot be undone.')) return;
                      window.localStorage.removeItem('paStudyAppState');
                      window.location.reload();
                    }}>Reset all data</button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="panel panel-small">
            <h2>Recommendation</h2>
            <p className="microcopy">Auto study recommendation based on exams and courses.</p>
            <div className="card-chip">{recommendation || 'No recommendation available'}</div>
          </section>
        </section>

        

        <section className="panel">
          <h2>Weekly calendar</h2>
          <p className="microcopy">Click any session to start the 90-minute focused timer.</p>
          <div className="calendar-grid">
            {weekDates.map((wd) => {
              const sessions = state.schedule.filter((s) => s.date === wd.key);
              return (
                <div key={wd.key} className="calendar-day">
                  <h4>{formatDateWithDay(wd.date.toISOString())}</h4>
                  {sessions.length ? sessions.map((session) => (
                    <div key={session.id} className="calendar-session" onClick={() => startSessionTimer(session.id)}>
                      <div style={{ fontWeight: 700 }}>{session.examName}</div>
                      <div style={{ fontSize: '0.9rem' }}>{formatTime12(session.start)} — {formatTime12(session.end)}</div>
                      <div style={{ marginTop: 6 }}>
                        {session.courses.slice(0,3).map((t) => {
                          const c = state.courses.find((x) => x.title === t) || {};
                          const border = '4px solid ' + (c.color || '#2055b1');
                          return (<span key={t} className="chip" style={{ marginRight: 6, borderLeft: border }}>{t}</span>);
                        })}
                      </div>
                    </div>
                  )) : <div className="microcopy">No sessions</div>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <h2>Philosophy & How to use</h2>
          <div className="philosophy">
            <h3>Why Retriev works</h3>
            <p>Retriev is built on evidence from learning science (summarized in Learning That Lasts): frequent retrieval practice strengthens memory, spaced repetition times reviews to reinforce retention, and interleaving different but related courses improves transfer and discrimination.</p>
            <p>We also use elaborative interrogation (asking "why" and "how" to deepen understanding), dual coding (combining visuals with text), and concrete examples to anchor abstract concepts.</p>

            <h3>How to use Retriev effectively</h3>
            <p>Upload notes within 24 hours of a lecture so the system can extract high-yield course headings. Do your daily queue each morning when you're fresh. Use the elaboration prompts — write an example or teach it back. Rate yourself honestly; the scheduler depends on accurate feedback.</p>

            <h3>Good study session (step-by-step)</h3>
            <ol>
              <li>Start a 90-minute session from the calendar or schedule.</li>
              <li>Spend 10–15 minutes on quick retrieval of each course's key concepts.</li>
              <li>Work through an active practice question, then check the explanation and add a concrete example.</li>
              <li>Use dual coding: sketch a quick diagram or concept map for 5 minutes.</li>
              <li>Finish with a short teach-back summary and honestly rate your performance.</li>
            </ol>

            <h3>FAQ</h3>
            <p><strong>Q:</strong> Why does this feel harder than re-reading?</p>
            <p><strong>A:</strong> Retrieval is effortful — that difficulty signals stronger encoding. Re-reading feels easy but produces weak, short-lived gains; retrieval produces durable learning.</p>
            <p><strong>Q:</strong> What if I keep getting something wrong?</p>
            <p><strong>A:</strong> The scheduler will bring it up sooner. Use concrete examples and spaced, mixed practice to build fluency.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
