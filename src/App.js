import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import { claudeComplete } from './anthropicClient';
import {
  buildStudySchedule,
  countDaysBetween,
  extractTextFromPdf,
  extractTextFromPptx,
  formatDate,
  formatDateWithDay,
  formatTime12,
  getTodayKey,
  loadAppState,
  saveAppState,
  safeParseJson,
} from './helpers';

const initialState = {
  theme: 'dark',
  courses: [],
  exams: [],
  schedule: [],
  history: [],
  availability: { wake: '07:00', sleep: '23:00', blocked: [] },
  uploadDraftNotes: [],
};

const ratingButtons = [
  { label: 'Again', value: 'again', className: 'rating-missed', interval: '<10 min' },
  { label: 'Hard', value: 'hard', className: 'rating-hard', interval: '1 day' },
  { label: 'Medium', value: 'good', className: 'rating-good', interval: '2 days' },
  { label: 'Easy', value: 'easy', className: 'rating-easy', interval: '3 days' },
];

function ExamNotesRow({ exam, state, loading, onUpload }) {
  const [open, setOpen] = React.useState(false);
  const notes = exam.notes || [];
  const course = state.courses.find((c) => c.id === exam.courseId);

  return (
    <article className="content-card">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setOpen(!open)}
      >
        <div>
          <strong>{exam.name}{course ? ` — ${course.title}` : ''}</strong>
          <span className="microcopy" style={{ marginLeft: 10 }}>{notes.length} file{notes.length !== 1 ? 's' : ''}</span>
        </div>
        <span>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {notes.map((note) => (
            <div key={note.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <span>{note.name}</span>
              <span className="microcopy">{formatDate(note.importedAt)}</span>
            </div>
          ))}
          {!notes.length && <p className="microcopy">No notes uploaded for this exam yet.</p>}
          <label style={{ display: 'block', marginTop: 12 }}>
            <span className="microcopy">Add notes to this exam</span>
            <input
              type="file"
              accept=".pdf,.txt,.pptx"
              multiple
              disabled={loading}
              onChange={(e) => onUpload(exam.id, Array.from(e.target.files || []))}
              style={{ display: 'block', marginTop: 6 }}
            />
          </label>
        </div>
      )}
    </article>
  );
}

function App() {
  const [state, setState] = useState(() => loadAppState() || initialState);
  const [view, setView] = useState('home');
  const [courseDraft, setCourseDraft] = useState('');
  const [examName, setExamName] = useState('Exam 1');
  const [examDate, setExamDate] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState(state.theme || 'dark');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [sessionState, setSessionState] = useState(null);
  const [timerState, setTimerState] = useState({ sessionId: null, remaining: 0, running: false });
  const [recommendation, setRecommendation] = useState('');

  useEffect(() => {
    saveAppState({ ...state, theme });
  }, [state, theme]);

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
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() + index);
      return { key: date.toISOString().slice(0, 10), date };
    });
  }, []);

  const todayKey = getTodayKey();

  const SYSTEM_PROMPT = `You are an expert medical educator creating Anki-style flashcards for a PA student. Extract only high-yield testable content that a student would need to know for an exam. 

STRICT RULES:
- Front must be a clear, specific question about a concept, mechanism, structure, or clinical fact
- Back must be a concise answer of 1-3 sentences
- ONLY include anatomical structures, physiological mechanisms, definitions, pathology, and clinical facts
- DO NOT include figure captions, image descriptions, citations, author names, journal references, movie/video descriptions, or any metadata
- DO NOT include professor information, course logistics, or administrative content
- If a line looks like a citation, caption, or reference — skip it entirely

Return ONLY a valid JSON array: [{"front": "question", "back": "answer"}]`;

  const dueCourses = useMemo(
    () => (state.courses || []).filter((course) => course.nextDue && course.nextDue <= todayKey),
    [state.courses, todayKey]
  );

  const coursesDueSorted = useMemo(
    () => (state.courses || []).slice().sort((a, b) => (a.nextDue || '').localeCompare(b.nextDue || '') || a.title.localeCompare(b.title)),
    [state.courses]
  );

  useEffect(() => {
    if (!state.exams.length || !state.courses.length) {
      setRecommendation('Add an exam and a few courses to get a study recommendation.');
      return;
    }
    const nextExam = state.exams
      .map((exam) => ({ ...exam, dateObj: new Date(exam.date) }))
      .filter((exam) => exam.dateObj >= new Date())
      .sort((a, b) => a.dateObj - b.dateObj)[0];
    if (!nextExam) {
      setRecommendation('All exams are in the past. Add a new exam to keep your schedule current.');
      return;
    }
    const days = countDaysBetween(new Date(), nextExam.dateObj) || 1;
    const hours = Math.ceil(state.courses.length / Math.max(1, days));
    setRecommendation(`Aim for ${hours} hour${hours === 1 ? '' : 's'} daily ahead of ${formatDate(nextExam.dateObj)}.`);
  }, [state.exams, state.courses]);

  const completedToday = useMemo(
    () => state.history.filter((item) => item.date.slice(0, 10) === todayKey && item.type === 'session').length,
    [state.history, todayKey]
  );

  const progressPercent = Math.round((completedToday / Math.max(1, dueCourses.length)) * 100);

  const streak = useMemo(() => {
    const days = Array.from(new Set(state.history.map((item) => item.date.slice(0, 10)))).sort((a, b) => (a > b ? -1 : 1));
    let count = 0;
    for (let index = 0; index < days.length; index += 1) {
      const date = new Date(days[index]);
      const delta = Math.round((new Date().setHours(0, 0, 0, 0) - date.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
      if (delta === index) count += 1;
      else break;
    }
    return count;
  }, [state.history]);

  const weeklyReport = useMemo(() => {
    const mastered = state.courses.filter((c) => c.stats.easy >= 3 && c.stats.totalReviews >= 4).length;
    const needsWork = state.courses.filter((c) => (c.stats.hard || 0) + (c.stats.again || 0) >= 2).length;
    return { mastered, needsWork, total: state.courses.length };
  }, [state.courses]);

  const weakCourses = useMemo(() => {
    return state.courses
      .filter((course) => (course.stats.hard || 0) + (course.stats.again || 0) >= 2)
      .sort((a, b) => (b.stats.hard || 0) - (a.stats.hard || 0));
  }, [state.courses]);

  function updateAppState(changes) {
    setState((prev) => ({ ...prev, ...changes }));
  }

  async function handleCourseFilesUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setLoading(true);
    setUploadMessage('Extracting text from uploaded notes...');

    try {
      const parsedNotes = [];
      for (const file of files) {
        if (file.size > 40 * 1024 * 1024) {
          throw new Error('File is too large. Use a smaller PDF or split the file.');
        }

        let text = '';
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.pdf')) {
          text = await extractTextFromPdf(file);
        } else if (lower.endsWith('.pptx')) {
          text = await extractTextFromPptx(file);
        } else {
          text = await file.text();
        }

        parsedNotes.push({
          id: `${file.name}-${Date.now()}`,
          name: file.name,
          type: file.type || 'text/plain',
          text,
          extractedText: text,
          importedAt: new Date().toISOString(),
        });
      }

      updateAppState({ uploadDraftNotes: [...(state.uploadDraftNotes || []), ...parsedNotes] });
      setUploadMessage(`Added ${parsedNotes.length} note${parsedNotes.length === 1 ? '' : 's'}.`);
    } catch (error) {
      console.error(error);
      setUploadMessage(error.message || 'Upload failed.');
    } finally {
      setLoading(false);
      if (event.target) event.target.value = '';
    }
  }

  function handleRemoveNote(noteId) {
    updateAppState({ uploadDraftNotes: (state.uploadDraftNotes || []).filter((note) => note.id !== noteId) });
  }

  function handleDeleteCourse(courseId) {
    const course = state.courses.find((c) => c.id === courseId);
    updateAppState({
      courses: state.courses.filter((course) => course.id !== courseId),
      exams: state.exams.filter((exam) => exam.courseId !== courseId),
      history: state.history.filter((item) => item.courseId !== courseId),
      schedule: state.schedule.filter((s) => !(course && Array.isArray(s.courses) && s.courses.includes(course.title))),
    });
    if (selectedCourseId === courseId) setSelectedCourseId('');
  }

  function handleDeleteExam(examId) {
    const exam = state.exams.find((e) => e.id === examId);
    updateAppState({
      exams: state.exams.filter((exam) => exam.id !== examId),
      schedule: state.schedule.filter((s) => !(exam && s.examName === exam.name)),
    });
  }

  function formatExamLabel(exam) {
    if (!exam) return '';
    if (exam.name?.includes(' - ')) return exam.name;
    const course = state.courses.find((courseItem) => courseItem.id === exam.courseId);
    return course ? `${exam.name.trim()} - ${course.title}` : exam.name.trim();
  }

  async function handleAddCourse(event) {
    event.preventDefault();
    const title = courseDraft.trim();
    if (!title || !examDate) {
      setStatusMessage('Enter a course name and exam date before saving.');
      return;
    }

    const courseId = `course-${Date.now()}`;
    const examId = `exam-${Date.now()}`;
    const newCourse = {
      id: courseId,
      title,
      notes: [],
      nextDue: todayKey,
      stats: { easy: 0, good: 0, hard: 0, again: 0, totalReviews: 0 },
      createdAt: new Date().toISOString(),
    };
    const newExam = {
      id: examId,
      name: examName.trim() || 'Exam 1',
      date: examDate,
      courseId,
    };

    updateAppState({
      courses: [...state.courses, newCourse],
      exams: [...state.exams, { ...newExam, notes: state.uploadDraftNotes || [] }],
      uploadDraftNotes: [],
    });
    setCourseDraft('');
    setExamName('Exam 1');
    setExamDate('');
    setUploadMessage('');
    setStatusMessage('Course saved. It is now in your study queue.');
    setView('home');
  }

  async function handleExamNotesUpload(examId, files) {
    if (!files.length) return;
    setLoading(true);
    try {
      const parsedNotes = [];
      for (const file of files) {
        let text = '';
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.pdf')) {
          text = await extractTextFromPdf(file);
        } else if (lower.endsWith('.pptx')) {
          text = await extractTextFromPptx(file);
        } else {
          text = await file.text();
        }
        parsedNotes.push({
          id: `${file.name}-${Date.now()}`,
          name: file.name,
          type: file.type || 'text/plain',
          text,
          extractedText: text,
          importedAt: new Date().toISOString(),
        });
      }
      updateAppState({
        exams: state.exams.map((e) =>
          e.id === examId
            ? { ...e, notes: [...(e.notes || []), ...parsedNotes] }
            : e
        ),
      });
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  function handleGenerateSchedule() {
    if (!state.exams.length || !state.courses.length) {
      setStatusMessage('Add both exams and courses before generating a schedule.');
      return;
    }
    const schedule = buildStudySchedule(state.exams, state.courses, state.availability || initialState.availability);
    updateAppState({ schedule });
    setStatusMessage('Study schedule created based on your upcoming exams.');
  }

  function handleSelectCourse(courseId) {
    setSelectedCourseId(courseId);
    setView('session');
  }

  function wordCount(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function getDesiredCardCount(text) {
    const words = wordCount(text);
    if (words < 800) {
      return Math.max(15, Math.min(25, Math.round(words / 45)));
    }
    if (words < 2500) {
      return Math.max(25, Math.min(45, Math.round(words / 55)));
    }
    return Math.max(40, Math.min(60, Math.round(words / 60)));
  }

  function nextReviewDate(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function buildCard(front, back) {
    return {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      front,
      back,
      term: front,
      definition: back,
      interval: 1,
      easeFactor: 2.5,
      repetitions: 0,
      nextReview: todayKey,
    };
  }

  function sm2Review(card, rating) {
    const ease = card.easeFactor || 2.5;
    let interval = card.interval || 1;
    let repetitions = card.repetitions || 0;
    let nextInterval = interval;
    let nextEase = ease;

    if (rating === 'again') {
      repetitions = 0;
      nextInterval = 1;
      nextEase = Math.max(1.3, ease - 0.2);
    } else if (rating === 'hard') {
      repetitions += 1;
      nextEase = Math.max(1.3, ease - 0.15);
      nextInterval = 1;
    } else if (rating === 'good') {
      repetitions += 1;
      nextInterval = 2;
    } else if (rating === 'easy') {
      repetitions += 1;
      nextEase = Math.max(1.3, ease + 0.15);
      nextInterval = 3;
    }

    return {
      ...card,
      interval: nextInterval,
      easeFactor: nextEase,
      repetitions,
      nextReview: nextReviewDate(nextInterval),
    };
  }

  function getCourseNotesText(course) {
    const exam = state.exams.find((e) => e.courseId === course.id);
    const notes = exam?.notes?.length ? exam.notes : course.notes || [];
    if (!notes.length) return course.title || '';
    return notes
      .map((note) => `${note.name}\n${note.extractedText ?? note.text ?? ''}`)
      .join('\n\n');
  }

  async function prepareCourseFlashcards(course) {
    const notesText = getCourseNotesText(course);
    if (!notesText.trim()) {
      throw new Error('Could not read PDF content — try re-uploading your notes.');
    }

    const desiredCount = getDesiredCardCount(notesText);
    const humanPrompt = `Notes:\n${notesText}\n\nCreate approximately ${desiredCount} flashcards.`;

    console.log('Sending extracted text to Claude:', notesText.slice(0, 500));

    try {
      const raw = await claudeComplete(humanPrompt, 1200, SYSTEM_PROMPT);
      console.log('Raw Claude response for flashcards:', raw);

      const data = typeof raw === 'string' ? { content: [{ text: raw }] } : raw;
      const rawText = data.content[0].text;
      console.log('Raw text first 100 chars:', rawText.substring(0, 100));
      let cleanText = rawText;
      if (cleanText.includes('```')) {
        cleanText = cleanText.replace(/```json/g, '').replace(/```/g, '');
      }
      cleanText = cleanText.trim();
      const lastBracket = cleanText.lastIndexOf(']');
      if (lastBracket > -1) {
        cleanText = cleanText.substring(0, lastBracket + 1);
      }
      console.log('Clean text first 100 chars:', cleanText.substring(0, 100));
      const flashcards = JSON.parse(cleanText);
      console.log('Parsed flashcards count:', flashcards.length);

      if (Array.isArray(flashcards) && flashcards.length) {
        const cards = flashcards.slice(0, Math.max(desiredCount, flashcards.length)).map((item, index) => {
          const front = item.front || item.question || item.term || `Card ${index + 1}`;
          const back = item.back || item.answer || item.definition || '';
          return buildCard(front, back);
        });
        updateAppState({
          courses: state.courses.map((item) => (item.id === course.id ? { ...item, flashcards: cards } : item)),
        });
        return cards;
      }
    } catch (error) {
      console.error(error);
    }

    const fallbackLines = notesText.split(/\n|\r/).filter(Boolean).slice(0, 10);
    const fallbackCards = fallbackLines.map((line, index) => buildCard(line.slice(0, 60), line.slice(0, 160)));
    updateAppState({
      courses: state.courses.map((item) => (item.id === course.id ? { ...item, flashcards: fallbackCards } : item)),
    });
    return fallbackCards;
  }

  const createQuizForCourse = useCallback(async (course) => {
    const getCourseNotesTextForQuiz = (courseItem) => {
      const exam = state.exams.find((e) => e.courseId === courseItem.id);
      const notes = exam?.notes?.length ? exam.notes : courseItem.notes || [];
      if (!notes.length) return courseItem.title || '';
      return notes
        .map((note) => `${note.name}\n${note.extractedText ?? note.text ?? ''}`)
        .join('\n\n');
    };

    const notesText = getCourseNotesTextForQuiz(course);
    const prompt = `You are a PA school study coach. Based on this course title and notes, create 4 exam-style quiz questions. Return valid JSON as an array with objects: { question, type, choices, answer, explanation }. Use "multiple-choice" for 2 questions and "short-answer" for 2 questions. Do not include extra text.\n\nCourse title: ${course.title}\nNotes:\n${notesText}`;
    try {
      const raw = await claudeComplete(prompt, 900);
      const parsed = safeParseJson(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((item, index) => ({
          id: `quiz-${Date.now()}-${index}`,
          question: item.question || item.prompt || `Question ${index + 1}`,
          type: item.type || (Array.isArray(item.choices) && item.choices.length ? 'multiple-choice' : 'short-answer'),
          choices: Array.isArray(item.choices) ? item.choices : [],
          answer: item.answer || item.correctAnswer || '',
          explanation: item.explanation || '',
        }));
      }
    } catch (error) {
      console.error(error);
    }

    return Array.from({ length: 4 }, (_, index) => ({
      id: `quiz-fallback-${index}`,
      question: `Write a short answer for concept ${index + 1}.`,
      type: 'short-answer',
      choices: [],
      answer: '',
      explanation: '',
    }));
  }, [state.exams]);

  function getDueFlashcards(course) {
    const cards = course.flashcards || [];
    const due = cards.filter((card) => !card.nextReview || card.nextReview <= todayKey);
    return due.length ? due : cards.slice(0, 10);
  }

  async function startSession(courseId) {
    const course = state.courses.find((item) => item.id === courseId);
    if (!course) return;
    setView('session');
    setSelectedCourseId(courseId);
    setSessionState({ phase: 'loading', courseId, queue: [], flipped: false, completed: 0, total: 0, quizQuestions: [], answers: {}, score: null, summary: '', message: 'Preparing flashcards…' });

    let cards = getDueFlashcards(course);
    if (!cards.length) {
      setSessionState({ phase: 'loading', courseId, queue: [], flipped: false, completed: 0, total: 0, quizQuestions: [], answers: {}, score: null, summary: '', message: 'Generating flashcards from your notes...' });
      try {
        cards = await prepareCourseFlashcards(course);
      } catch (error) {
        setSessionState({ phase: 'summary', courseId, queue: [], flipped: false, completed: 0, total: 0, quizQuestions: [], answers: {}, score: null, summary: error.message || 'Failed to generate flashcards.' });
        return;
      }
    }

    setSessionState({ phase: 'flashcards', courseId, queue: cards, flipped: false, completed: 0, total: cards.length, quizQuestions: [], answers: {}, score: null, summary: '', message: '' });
  }

  useEffect(() => {
    if (!sessionState || sessionState.phase !== 'quiz-loading') return;
    async function buildQuiz() {
      const course = state.courses.find((item) => item.id === sessionState.courseId);
      if (!course) {
        setSessionState((prev) => ({ ...prev, phase: 'summary', summary: 'Course not found.' }));
        return;
      }
      const questions = await createQuizForCourse(course);
      setSessionState((prev) => ({ ...prev, phase: 'quiz', quizQuestions: questions, answers: {}, message: '' }));
    }
    buildQuiz();
  }, [sessionState, state.courses, createQuizForCourse]);

  function rateFlashcard(rating) {
    if (!sessionState || sessionState.phase !== 'flashcards') return;
    const [current, ...rest] = sessionState.queue;
    if (!current) return;
    const course = state.courses.find((item) => item.id === sessionState.courseId);
    if (course) {
      const updatedCard = sm2Review(current, rating);
      const updatedFlashcards = (course.flashcards || []).map((card) => (card.id === current.id ? updatedCard : card));
      const nextDue = updatedFlashcards.reduce((min, card) => {
        if (!min || card.nextReview < min) return card.nextReview;
        return min;
      }, null);
      const updatedCourse = {
        ...course,
        flashcards: updatedFlashcards,
        nextDue,
        stats: {
          ...course.stats,
          [rating]: (course.stats[rating] || 0) + 1,
          totalReviews: (course.stats.totalReviews || 0) + 1,
        },
      };
      updateAppState({
        courses: state.courses.map((item) => (item.id === course.id ? updatedCourse : item)),
      });
    }

    const nextQueue = [...rest];
    if (rating === 'again' || rating === 'hard') {
      nextQueue.push(sm2Review(current, rating));
    }
    const completed = sessionState.completed + 1;

    if (nextQueue.length === 0) {
      setSessionState((prev) => ({
        ...prev,
        phase: 'quiz-loading',
        queue: nextQueue,
        completed,
        message: 'Generating a short quiz from these concepts…',
      }));
      return;
    }

    setSessionState((prev) => ({ ...prev, queue: nextQueue, completed, flipped: false }));
  }

  function handleFlipCard() {
    setSessionState((prev) => (prev ? { ...prev, flipped: !prev.flipped } : prev));
  }

  function updateQuizAnswer(questionId, value) {
    setSessionState((prev) => ({ ...prev, answers: { ...prev.answers, [questionId]: value } }));
  }

  function gradeQuiz() {
    if (!sessionState || sessionState.phase !== 'quiz') return;
    const answers = sessionState.answers || {};
    let correct = 0;
    const scored = sessionState.quizQuestions.map((item) => {
      const userAnswer = (answers[item.id] || '').trim();
      const expected = (item.answer || '').trim();
      const matched = item.type === 'multiple-choice'
        ? userAnswer === expected
        : expected && userAnswer.toLowerCase().includes(expected.toLowerCase());
      if (matched) correct += 1;
      return { ...item, given: userAnswer, isCorrect: matched };
    });
    const score = Math.round((correct / Math.max(1, scored.length)) * 100);
    setSessionState((prev) => ({ ...prev, phase: 'summary', score, quizQuestions: scored, summary: `You scored ${correct} out of ${scored.length}. Review any missed concepts in your next session.`, completedSession: true }));
    const course = state.courses.find((item) => item.id === sessionState.courseId);
    updateAppState({
      history: [
        { id: `history-${Date.now()}`, courseId: sessionState.courseId, title: course?.title || '', type: 'session', date: new Date().toISOString() },
        ...state.history,
      ],
    });
  }

  function endSession() {
    setView('home');
    setSessionState(null);
  }

  function renderHome() {
    return (
      <>
        <section className="panel-grid top-grid">
          <section className="panel study-queue">
            <div className="panel-heading-row">
              <div>
                <h2>Study queue</h2>
                <p className="microcopy">Click a course card to begin the study session.</p>
              </div>
              <button className="big-button" type="button" onClick={() => setView('add')}>Add Course</button>
            </div>
            <div className="course-list">
              {coursesDueSorted.length ? coursesDueSorted.map((course) => (
                <article key={course.id} className="course-card" onClick={() => handleSelectCourse(course.id)} style={{ borderLeft: `4px solid ${course.color || '#2055b1'}` }}>
                  <div>
                    <strong>{course.title}</strong>
                    <p className="microcopy">Next review: {course.nextDue ? formatDate(course.nextDue) : 'Not scheduled'}</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button type="button" className="primary-outline" onClick={(e) => { e.stopPropagation(); startSession(course.id); }}>Study</button>
                    <button type="button" className="secondary" onClick={(e) => { e.stopPropagation(); handleDeleteCourse(course.id); }} title="Delete course">🗑️</button>
                  </div>
                </article>
              )) : <p>No courses available. Add a course to populate the study queue.</p>}
            </div>
          </section>

          <section className="panel panel-large panel-compact">
            <h2>Dashboard</h2>
            <div className="subsection-group">
              <div className="report-card report-sub">
                <strong>Weekly report</strong>
                <p>{weeklyReport.mastered} mastered</p>
                <p>{weeklyReport.needsWork} need more work</p>
                <p>{weeklyReport.total} total courses</p>
              </div>
              <div className="report-card report-sub">
                <strong>Weak spot tracker</strong>
                {state.courses.length ? weakCourses.slice(0, 3).map((course) => (
                  <p key={course.id}><span style={{ color: course.color }}>{course.title}</span> � {course.stats.hard || 0} hard reviews</p>
                )) : <p>No weak spots yet.</p>}
              </div>
            </div>
          </section>
        </section>

        <section className="panel-grid panel-grid-spacious">
          <section className="panel panel-large upload-panel">
            <h2>Exam notes</h2>
            <p className="microcopy">Click an exam to view or add notes for that exam.</p>
            <div className="content-list">
              {state.exams.map((exam) => (
                <ExamNotesRow
                  key={exam.id}
                  exam={exam}
                  state={state}
                  loading={loading}
                  onUpload={handleExamNotesUpload}
                />
              ))}
              {!state.exams.length && <p className="microcopy">No exams yet. Add a course to get started.</p>}
            </div>
          </section>

          <section className="panel panel-small">
            <h2>Exam plans</h2>
            <div className="chip-list">
              {state.exams.map((exam) => (
                <div key={exam.id} className="exam-item">
                  <div>
                    <strong>{formatExamLabel(exam)}</strong>
                    <div className="microcopy">{formatDate(exam.date)}</div>
                    <div className="microcopy">{exam.topics}</div>
                  </div>
                  <button type="button" className="secondary" onClick={() => handleDeleteExam(exam.id)} title="Delete exam">🗑️</button>
                </div>
              ))}
              {!state.exams.length && <p className="microcopy">No exams planned yet.</p>}
            </div>
            <button type="button" className="primary-outline" onClick={handleGenerateSchedule} disabled={!state.exams.length || !state.courses.length}>Generate study schedule</button>
          </section>
        </section>

        <section className="panel-grid panel-grid-spacious">
          <section className="panel panel-large right-column-large">
            <h2>My schedule</h2>
            <p className="microcopy">Set your availability so the schedule only targets times you can study.</p>
            <div style={{ display: 'grid', gap: 12 }}>
              <label>
                Wake time
                <input type="time" value={state.availability.wake} onChange={(e) => updateAppState({ availability: { ...state.availability, wake: e.target.value } })} />
              </label>
              <label>
                Sleep time
                <input type="time" value={state.availability.sleep} onChange={(e) => updateAppState({ availability: { ...state.availability, sleep: e.target.value } })} />
              </label>
              <div>
                <strong>Blocked slots</strong>
                {state.availability.blocked.length ? (
                  <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                    {state.availability.blocked.map((block, index) => (
                      <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>{block.label || 'Busy'}</div>
                        <div className="microcopy">{block.start} � {block.end}</div>
                        <button type="button" className="secondary" onClick={() => updateAppState({ availability: { ...state.availability, blocked: state.availability.blocked.filter((_, idx) => idx !== index) } })}>Remove</button>
                      </div>
                    ))}
                  </div>
                ) : <p className="microcopy">No blocked slots defined.</p>}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input placeholder="Label" id="block-label" />
                  <input type="time" id="block-start" />
                  <input type="time" id="block-end" />
                </div>
                <button type="button" className="primary-outline" onClick={() => {
                  const label = document.getElementById('block-label')?.value || 'Busy';
                  const start = document.getElementById('block-start')?.value;
                  const end = document.getElementById('block-end')?.value;
                  if (!start || !end) return;
                  updateAppState({ availability: { ...state.availability, blocked: [...state.availability.blocked, { label, start, end }] } });
                  if (document.getElementById('block-label')) document.getElementById('block-label').value = '';
                  if (document.getElementById('block-start')) document.getElementById('block-start').value = '';
                  if (document.getElementById('block-end')) document.getElementById('block-end').value = '';
                }}>Add blocked slot</button>
              </div>
            </div>
          </section>

          <section className="panel panel-small">
            <h2>Recommendation</h2>
            <p className="microcopy">Automatic advice based on your upcoming exams and course load.</p>
            <div className="card-chip">{recommendation}</div>
          </section>
        </section>

        <section className="panel">
          <h2>Weekly calendar</h2>
          <p className="microcopy">Exam dates and study sessions appear on the same weekly view.</p>
          <div className="calendar-grid">
            {weekDates.map((day) => {
              const sessions = state.schedule.filter((session) => session.date === day.key);
              const exams = state.exams.filter((exam) => exam.date === day.key);
              return (
                <div key={day.key} className="calendar-day">
                  <h4>{formatDateWithDay(day.date.toISOString())}</h4>
                  {exams.map((exam) => (
                    <div key={exam.id} className="calendar-exam">
                      <strong>{formatExamLabel(exam)}</strong>
                      <div className="microcopy">{exam.topics}</div>
                    </div>
                  ))}
                  {sessions.length ? sessions.map((session) => {
                    return (
                      <div key={session.id} className="calendar-session">
                        <div style={{ fontWeight: 700 }}>{session.examName}</div>
                        <div style={{ fontSize: '0.9rem' }}>{formatTime12(session.start)} — {formatTime12(session.end)}</div>
                      </div>
                    );
                  }) : <div className="microcopy">No sessions</div>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <h2>Philosophy</h2>
          <div className="philosophy">
            <h3>Why RETRIEV works</h3>
            <p>Speedy retrieval, spaced repetition, and exam-style quizzes help move information from short-term memory into lasting understanding.</p>
            <h3>How to use this app</h3>
            <p>Start on the home page: add a course, upload notes, and create an exam plan. Then open a study session and use the flashcards and quiz flow.</p>
            <h3>Study flow</h3>
            <ol>
              <li>Add a course and attach your notes.</li>
              <li>Review the study queue and open a session.</li>
              <li>Flip cards, rate yourself honestly, and finish with a quiz.</li>
              <li>Schedule your next review and revisit weak concepts.</li>
            </ol>
          </div>
        </section>
      </>
    );
  }

  function renderAddCourse() {
    return (
      <section className="panel">
        <div className="panel-heading-row">
          <div>
            <h2>Add Course</h2>
            <p className="microcopy">Complete the three steps to add a new course and exam plan.</p>
          </div>
          <button type="button" className="secondary" onClick={() => setView('home')}>Back to home</button>
        </div>

        <div className="steps">
          <div className="step">
            <div className="step-header">
              <span className="step-mark">1</span>
              <strong>Enter course name</strong>
            </div>
            <input value={courseDraft} onChange={(e) => setCourseDraft(e.target.value)} placeholder="Neuroscience exam prep" />
          </div>

          <div className="step">
            <div className="step-header">
              <span className="step-mark">2</span>
              <strong>Upload notes or slides</strong>
            </div>
            <input type="file" accept=".pdf,.txt,.pptx" multiple onChange={handleCourseFilesUpload} disabled={loading} />
            <p className="microcopy">{uploadMessage}</p>
            <div className="content-list">
              {(state.uploadDraftNotes || []).map((note) => (
                <article key={note.id} className="note-card">
                  <div>
                    <strong>{note.name}</strong>
                    <div className="microcopy">{note.type || 'file'}</div>
                  </div>
                  <button type="button" className="secondary" onClick={() => handleRemoveNote(note.id)}>🗑️</button>
                </article>
              ))}
              {!state.uploadDraftNotes?.length && <p className="microcopy">Upload PDFs, lecture slides, or text notes for this course.</p>}
            </div>
          </div>

          <div className="step">
            <div className="step-header">
              <span className="step-mark">3</span>
              <strong>Enter exam details</strong>
            </div>
            <label>
              Exam name
              <input value={examName} onChange={(e) => setExamName(e.target.value)} placeholder="Exam 1 - Neuroscience" />
            </label>
            <label>
              Exam date
              <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            </label>
            
          </div>
        </div>

        <div style={{ marginTop: 22, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="big-button" type="button" onClick={handleAddCourse}>Save course</button>
          <button className="secondary" type="button" onClick={() => setView('home')}>Cancel</button>
          <span className="microcopy">{statusMessage}</span>
        </div>
      </section>
    );
  }

  function renderSession() {
    const course = state.courses.find((item) => item.id === selectedCourseId);
    if (!course) {
      return (
        <section className="panel">
          <h2>Course not found</h2>
          <p className="microcopy">Return to home and try another course.</p>
          <button className="big-button" type="button" onClick={() => { setView('home'); setSelectedCourseId(''); }}>Back to home</button>
        </section>
      );
    }

    const currentCard = sessionState?.queue?.[0];
    const exam = state.exams.find((item) => item.courseId === course.id);

    return (
      <section className="panel">
        <div className="panel-heading-row">
          <div>
            <h2>{course.title}</h2>
            <p className="microcopy">Exam: {formatExamLabel(exam)}</p>
          </div>
          <button className="secondary" type="button" onClick={endSession}>Back to home</button>
        </div>

        {sessionState?.phase === 'loading' && (
          <div className="panel">
            <div className="loading-spinner" />
            <p>{sessionState.message}</p>
          </div>
        )}

        {sessionState?.phase === 'flashcards' && currentCard && (
          <div className="flashcard-panel">
            <div className="flashcard-meta">
              <span>{sessionState.completed}/{sessionState.total} reviewed</span>
              <span className="tag-pill">Remaining {sessionState.queue.length}</span>
            </div>
            <div className={`flashcard ${sessionState.flipped ? 'flipped' : ''}`}>
              <div>
                <div className="microcopy">Front</div>
                <h3>{currentCard.term}</h3>
              </div>
              <div className="flashcard-answer" style={{ marginTop: 18 }}>
                {sessionState.flipped ? (
                  <>
                    <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', margin: '0 0 16px 0' }} />
                    <div className="microcopy">Back</div>
                    <p>{currentCard.definition}</p>
                  </>
                ) : null}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="primary-outline" type="button" onClick={handleFlipCard}>{sessionState.flipped ? 'Hide answer' : 'Flip card'}</button>
                {sessionState.flipped && (
                  <div className="rating-group">
                    {ratingButtons.map((button) => (
                      <div key={button.value} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <button type="button" className={button.className} onClick={() => rateFlashcard(button.value)}>{button.label}</button>
                        <span className="microcopy" style={{ fontSize: '0.75rem' }}>{button.interval}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {sessionState?.phase === 'quiz-loading' && (
          <div className="panel">
            <p>{sessionState.message}</p>
          </div>
        )}

        {sessionState?.phase === 'quiz' && (
          <div className="panel">
            <h3>Quiz</h3>
            <p className="microcopy">Answer the questions based on what you learned from the flashcards.</p>
            {sessionState.quizQuestions.map((question) => (
              <article key={question.id} className="quiz-card">
                <strong>{question.question}</strong>
                {question.type === 'multiple-choice' ? (
                  <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                    {question.choices.map((choice) => (
                      <label key={choice} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <input
                          type="radio"
                          name={question.id}
                          value={choice}
                          checked={sessionState.answers[question.id] === choice}
                          onChange={(e) => updateQuizAnswer(question.id, e.target.value)}
                        />
                        <span>{choice}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <textarea
                    rows={4}
                    value={sessionState.answers[question.id] || ''}
                    onChange={(e) => updateQuizAnswer(question.id, e.target.value)}
                    placeholder="Type your answer here"
                  />
                )}
              </article>
            ))}
            <button className="big-button" type="button" onClick={gradeQuiz}>Submit quiz</button>
          </div>
        )}

        {sessionState?.phase === 'summary' && (
          <div className="panel">
            <h3>Session summary</h3>
            <p className="microcopy">{sessionState.summary}</p>
            {sessionState.score !== null ? (
              <div className="report-card report-sub">
                <strong>Score</strong>
                <p>{sessionState.score}%</p>
              </div>
            ) : null}
            <button className="big-button" type="button" onClick={endSession}>Return home</button>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className={`app-shell theme-${theme}`}>
      <header className="hero">
        <div className="brand-block">
          <span className="brand-icon">🧠</span>
          <span className="brand-name">RETRIEV</span>
        </div>
        <p className="hero-greeting">Good morning</p>
        <p className="subtitle">One place for courses, exams, flashcards, and spaced repetition.</p>
        <div className="status-bar">
          <div className="progress-wrap">
            <div className="progress-label">Today: {completedToday}/{dueCourses.length || 0} completed</div>
            <div className="progress-bar"><div className="progress-fill" style={{ width: `${progressPercent}%` }} /></div>
          </div>
          <div className="meta-chips">
            <span className="chip">{state.courses.length} courses</span>
            <span className="chip">{state.exams.length} exams</span>
            <span className="chip streak">🔥 {streak} day streak</span>
            <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
          </div>
        </div>
      </header>
      {view === 'home' && renderHome()}
      {view === 'add' && renderAddCourse()}
      {view === 'session' && renderSession()}
      <div className="status-bar" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
        <div className="meta-chips">
          {timerState.running ? <span className="chip">⏱ {Math.floor(timerState.remaining / 60)}:{String(timerState.remaining % 60).padStart(2, '0')}</span> : null}
          {timerState.running ? <button className="secondary" onClick={() => setTimerState({ sessionId: null, remaining: 0, running: false })}>Stop timer</button> : null}
          <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
        </div>
      </div>
    </div>
  );
}

export default App;
