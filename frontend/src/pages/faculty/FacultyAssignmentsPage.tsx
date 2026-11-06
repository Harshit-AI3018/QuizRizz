import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { facultyApi } from '../../api/facultyApi';
import type { FacultyAssignment } from '../../types/faculty';
import { Card } from '../../components/common/Card';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import {
  UserCheck,
  AlertTriangle,
  BookOpen,
  Calendar,
  Layers,
  Plus,
  Info,
} from 'lucide-react';

export const FacultyAssignmentsPage: React.FC = () => {
  const [assignments, setAssignments] = useState<FacultyAssignment[]>([]);
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadAuthoringContext = useCallback(async () => {
    setIsLoading(true);
    try {
      const [assignmentsRes, questionsRes, quizzesRes] = await Promise.allSettled([
        facultyApi.listAssignments ? facultyApi.listAssignments() : Promise.resolve([]),
        facultyApi.listQuestions({ limit: 500 }),
        facultyApi.listQuizzes({ limit: 500 }),
      ]);

      if (assignmentsRes.status === 'fulfilled' && assignmentsRes.value.length > 0) {
        setAssignments(assignmentsRes.value);
      } else {
        setAssignments([]);
      }

      const ids = new Set<string>();
      if (questionsRes.status === 'fulfilled') {
        questionsRes.value.forEach((q) => {
          if (q.subject_id) ids.add(q.subject_id);
        });
      }
      if (quizzesRes.status === 'fulfilled') {
        quizzesRes.value.forEach((qz) => {
          if (qz.subject_id) ids.add(qz.subject_id);
        });
      }

      setSubjectIds(Array.from(ids));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAuthoringContext();
  }, [loadAuthoringContext]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Faculty Assignments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Active class and subject assignments registered for your faculty account.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/faculty/quizzes/new">
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1.5" />
              Create Quiz
            </Button>
          </Link>
          <Link to="/faculty/questions/new">
            <Button size="sm" variant="secondary">
              <Plus className="w-4 h-4 mr-1.5" />
              Add Question
            </Button>
          </Link>
        </div>
      </div>

      {/* When formal backend assignments are present, show them */}
      {assignments.length > 0 ? (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900">
              Assigned Subjects & Teaching Classes
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors bg-white shadow-sm"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-base">
                      {assignment.subject_name}
                    </h3>
                    <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-mono font-medium rounded mt-1">
                      {assignment.subject_code}
                    </span>
                  </div>
                  <Badge variant={assignment.is_active ? 'green' : 'gray'} size="sm">
                    {assignment.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <div className="mt-3 space-y-1.5 text-xs text-gray-600 border-t border-gray-100 pt-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span>{assignment.class_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span>Academic Year: {assignment.academic_year_name}</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-400 truncate max-w-[160px]" title={assignment.subject_id}>
                    UUID: {assignment.subject_id.substring(0, 8)}...
                  </span>
                  <div className="flex gap-2">
                    <Link to={`/faculty/quizzes/new?subject_id=${assignment.subject_id}`}>
                      <Button size="sm" variant="ghost" className="text-xs py-1 px-2 h-auto text-blue-600 hover:text-blue-800">
                        New Quiz
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        /* Fallback Notice & Authoring activity when no direct assignments detected */
        <>
          <Card className="p-5 border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900 space-y-2">
                <h3 className="font-semibold text-base">Backend Contract Architecture Notice</h3>
                <p>
                  In the QuizRizz backend, faculty assignments to academic classes and subjects are
                  exclusively managed via the administrative endpoint:
                </p>
                <code className="inline-block px-2 py-1 bg-amber-100 rounded text-xs font-mono text-amber-900">
                  /api/v1/admin/academic/faculty-assignments
                </code>
                <p>
                  That endpoint requires the <Badge variant="purple" size="sm">ADMIN</Badge> role.
                  The backend now also provides self-service assignment discovery for faculty via{' '}
                  <code className="font-mono text-xs">/api/v1/faculty/assignments</code>.
                </p>
                <p>
                  To author questions and create quizzes, use the Subject UUID assigned by your college
                  curriculum coordinator.
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <BookOpen className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-semibold text-gray-900">
                Active Subject Contexts in Your Work
              </h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              The following Subject UUIDs are actively used by questions and quizzes created under your
              account:
            </p>

            {isLoading ? (
              <div className="py-8 flex justify-center">
                <Spinner size="md" />
              </div>
            ) : subjectIds.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">
                No authoring subjects found. When you create questions or quizzes with your assigned
                Subject UUID, they will appear here for easy reference.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {subjectIds.map((id) => (
                  <div key={id} className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                        <UserCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="font-mono text-sm text-gray-900 font-medium">{id}</span>
                        <p className="text-xs text-gray-500">Subject UUID</p>
                      </div>
                    </div>
                    <Badge variant="blue" size="sm">
                      Authoring Scope
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* Information card */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-gray-600 space-y-1">
            <h4 className="font-medium text-gray-900">Need a New Subject Assignment?</h4>
            <p>
              Please contact your college administrator or department head to create the subject or
              assign you as the teaching faculty for your course branch and class.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};
