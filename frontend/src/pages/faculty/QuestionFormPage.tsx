import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { facultyApi } from '../../api/facultyApi';
import type {
  QuestionType,
  Difficulty,
  QuestionOptionCreate,
} from '../../types/faculty';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  ArrowLeft,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export const QuestionFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { questionId } = useParams<{ questionId: string }>();
  const isEdit = Boolean(questionId);
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState<boolean>(isEdit);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form State
  const [subjectId, setSubjectId] = useState<string>('');
  const [questionType, setQuestionType] = useState<QuestionType>('MCQ');
  const [questionText, setQuestionText] = useState<string>('');
  const [explanation, setExplanation] = useState<string>('');
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [topic, setTopic] = useState<string>('');
  const [defaultMarks, setDefaultMarks] = useState<string>('1.0');
  const [defaultNegativePenalty, setDefaultNegativePenalty] = useState<string>('0.0');
  const [isBankQuestion, setIsBankQuestion] = useState<boolean>(true);

  // Options State
  const [options, setOptions] = useState<QuestionOptionCreate[]>([
    { option_text: '', is_correct: true, display_order: 1 },
    { option_text: '', is_correct: false, display_order: 2 },
    { option_text: '', is_correct: false, display_order: 3 },
    { option_text: '', is_correct: false, display_order: 4 },
  ]);

  // Load question for edit
  const loadQuestion = useCallback(async () => {
    if (!questionId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const q = await facultyApi.getQuestion(questionId);
      setSubjectId(q.subject_id);
      setQuestionType(q.question_type);
      setQuestionText(q.question_text);
      setExplanation(q.explanation || '');
      setDifficulty(q.difficulty);
      setTopic(q.topic || '');
      setDefaultMarks(String(q.default_marks));
      setDefaultNegativePenalty(String(q.default_negative_penalty));
      setIsBankQuestion(q.is_bank_question);

      if (q.options && q.options.length > 0) {
        setOptions(
          q.options.map((opt, index) => ({
            option_text: opt.option_text,
            is_correct: index === 0, // Default first option as correct if omitted by backend
            display_order: opt.display_order,
          }))
        );
      }
    } catch {
      setLoadError('Failed to load question details. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [questionId]);

  useEffect(() => {
    if (isEdit) {
      loadQuestion();
    }
  }, [isEdit, loadQuestion]);

  // Handle question type change (only in Create mode)
  const handleTypeChange = (newType: QuestionType) => {
    setQuestionType(newType);
    if (newType === 'TRUE_FALSE') {
      setOptions([
        { option_text: 'True', is_correct: true, display_order: 1 },
        { option_text: 'False', is_correct: false, display_order: 2 },
      ]);
    } else if (newType === 'MCQ') {
      setOptions([
        { option_text: '', is_correct: true, display_order: 1 },
        { option_text: '', is_correct: false, display_order: 2 },
        { option_text: '', is_correct: false, display_order: 3 },
        { option_text: '', is_correct: false, display_order: 4 },
      ]);
    } else if (newType === 'MULTIPLE_SELECT') {
      setOptions([
        { option_text: '', is_correct: true, display_order: 1 },
        { option_text: '', is_correct: false, display_order: 2 },
        { option_text: '', is_correct: false, display_order: 3 },
      ]);
    }
  };

  const addOption = () => {
    if (questionType === 'TRUE_FALSE') return;
    setOptions((prev) => [
      ...prev,
      {
        option_text: '',
        is_correct: false,
        display_order: prev.length + 1,
      },
    ]);
  };

  const removeOption = (index: number) => {
    if (questionType === 'TRUE_FALSE' || options.length <= 2) return;
    setOptions((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((opt, i) => ({
          ...opt,
          display_order: i + 1,
        }))
    );
  };

  const updateOptionText = (index: number, text: string) => {
    setOptions((prev) =>
      prev.map((opt, i) => (i === index ? { ...opt, option_text: text } : opt))
    );
  };

  const toggleOptionCorrect = (index: number) => {
    if (questionType === 'MCQ' || questionType === 'TRUE_FALSE') {
      // Radio behavior: exactly one correct
      setOptions((prev) =>
        prev.map((opt, i) => ({
          ...opt,
          is_correct: i === index,
        }))
      );
    } else {
      // Checkbox behavior: toggle current
      setOptions((prev) =>
        prev.map((opt, i) => (i === index ? { ...opt, is_correct: !opt.is_correct } : opt))
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!subjectId.trim()) {
      showToast('Subject UUID is required', 'error');
      return;
    }
    if (!questionText.trim()) {
      showToast('Question text is required', 'error');
      return;
    }
    const emptyOptions = options.some((o) => !o.option_text.trim());
    if (emptyOptions) {
      showToast('All options must have non-empty text', 'error');
      return;
    }

    const correctCount = options.filter((o) => o.is_correct).length;
    if (questionType === 'MCQ' || questionType === 'TRUE_FALSE') {
      if (correctCount !== 1) {
        showToast('Exactly one option must be marked as correct', 'error');
        return;
      }
    } else if (questionType === 'MULTIPLE_SELECT') {
      if (correctCount < 1) {
        showToast('At least one option must be marked as correct for Multiple Select', 'error');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (isEdit && questionId) {
        // Update question attributes
        await facultyApi.updateQuestion(questionId, {
          question_text: questionText.trim(),
          explanation: explanation.trim() || null,
          difficulty,
          topic: topic.trim() || null,
          default_marks: parseFloat(defaultMarks),
          default_negative_penalty: parseFloat(defaultNegativePenalty),
          is_bank_question: isBankQuestion,
        });

        // Replace options atomically
        await facultyApi.replaceQuestionOptions(questionId, {
          options: options.map((opt, i) => ({
            option_text: opt.option_text.trim(),
            is_correct: opt.is_correct,
            display_order: i + 1,
          })),
        });

        showToast('Question updated successfully', 'success');
        navigate('/faculty/questions');
      } else {
        // Create question
        await facultyApi.createQuestion({
          subject_id: subjectId.trim(),
          question_type: questionType,
          question_text: questionText.trim(),
          explanation: explanation.trim() || null,
          difficulty,
          topic: topic.trim() || null,
          default_marks: parseFloat(defaultMarks),
          default_negative_penalty: parseFloat(defaultNegativePenalty),
          is_bank_question: isBankQuestion,
          options: options.map((opt, i) => ({
            option_text: opt.option_text.trim(),
            is_correct: opt.is_correct,
            display_order: i + 1,
          })),
        });

        showToast('Question created successfully', 'success');
        navigate('/faculty/questions');
      }
    } catch {
      showToast(isEdit ? 'Failed to update question' : 'Failed to create question', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError) {
    return <ErrorDisplay message={loadError} onRetry={loadQuestion} />;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Navigation Header */}
      <div className="flex items-center gap-3">
        <Link to="/faculty/questions">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Bank
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          {isEdit ? 'Edit Question' : 'Create New Question'}
        </h1>
      </div>

      {isEdit && (
        <Card className="p-4 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 space-y-1">
              <p className="font-semibold">Correct Answer Verification Required</p>
              <p>
                In compliance with security rules, the backend excludes correct answer flags from
                read responses. Please verify that the correct option is selected below before
                saving.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Main Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Core Attributes */}
        <Card className="p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-900 border-b pb-2">
            Question Information
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subject UUID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                disabled={isEdit}
                placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
              {isEdit && (
                <p className="text-xs text-gray-400 mt-1">Subject cannot be changed after creation.</p>
              )}
            </div>

            <div>
              <label htmlFor="question-type" className="block text-sm font-medium text-gray-700 mb-1">
                Question Type <span className="text-red-500">*</span>
              </label>
              <select
                id="question-type"
                aria-label="Question Type"
                disabled={isEdit}
                value={questionType}
                onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="MCQ">Multiple Choice (Single Correct)</option>
                <option value="TRUE_FALSE">True / False</option>
                <option value="MULTIPLE_SELECT">Multiple Select (Multiple Correct)</option>
              </select>
              {isEdit && (
                <p className="text-xs text-gray-400 mt-1">Question type cannot be changed after creation.</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Question Text <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={4}
              placeholder="Enter the complete question prompt..."
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Explanation (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="Detailed explanation of the solution..."
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
              <input
                type="text"
                placeholder="e.g. Data Structures"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Marks</label>
              <input
                type="number"
                step="0.5"
                min="0.1"
                required
                value={defaultMarks}
                onChange={(e) => setDefaultMarks(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Negative Penalty (Marks deducted if incorrect)
              </label>
              <input
                type="number"
                step="0.25"
                min="0.0"
                value={defaultNegativePenalty}
                onChange={(e) => setDefaultNegativePenalty(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isBankQuestion}
                  onChange={(e) => setIsBankQuestion(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                />
                <span className="text-sm font-medium text-gray-700">
                  Include in Question Bank for future reuse
                </span>
              </label>
            </div>
          </div>
        </Card>

        {/* Options Management */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Question Options</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {questionType === 'MULTIPLE_SELECT'
                  ? 'Check all options that are correct answers.'
                  : 'Select the single radio button corresponding to the correct answer.'}
              </p>
            </div>
            {questionType !== 'TRUE_FALSE' && (
              <Button size="sm" variant="secondary" onClick={addOption} disabled={options.length >= 10}>
                <Plus className="w-4 h-4 mr-1" />
                Add Option
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {options.map((opt, index) => (
              <div
                key={index}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  opt.is_correct ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'
                }`}
              >
                {/* Correct marker selector */}
                <button
                  type="button"
                  onClick={() => toggleOptionCorrect(index)}
                  className={`p-1.5 rounded-full transition-colors ${
                    opt.is_correct
                      ? 'text-green-600 hover:text-green-700'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                  title={opt.is_correct ? 'Correct Answer' : 'Mark as Correct'}
                >
                  <CheckCircle2
                    className={`w-5 h-5 ${opt.is_correct ? 'fill-green-100 stroke-green-600' : ''}`}
                  />
                </button>

                {/* Display order tag */}
                <span className="text-xs font-semibold text-gray-400 w-5 text-center">
                  {opt.display_order}.
                </span>

                {/* Option text */}
                <input
                  type="text"
                  required
                  placeholder={`Option ${opt.display_order} text...`}
                  value={opt.option_text}
                  disabled={questionType === 'TRUE_FALSE'}
                  onChange={(e) => updateOptionText(index, e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />

                {/* Remove button */}
                {questionType !== 'TRUE_FALSE' && options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                    title="Remove option"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Submit Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            onClick={() => navigate('/faculty/questions')}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting} onClick={handleSubmit}>
            {isEdit ? 'Save Changes' : 'Create Question'}
          </Button>
        </div>
      </form>
    </div>
  );
};
