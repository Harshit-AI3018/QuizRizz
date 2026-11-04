import React, { useEffect, useState, useCallback } from 'react';
import { facultyApi } from '../../api/facultyApi';
import { Card } from '../../components/common/Card';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import {
  UserCheck,
  AlertTriangle,
  BookOpen,
  Info,
} from 'lucide-react';

export const FacultyAssignmentsPage: React.FC = () => {
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadAuthoringContext = useCallback(async () => {
    setIsLoading(true);
    try {
      const [questions, quizzes] = await Promise.allSettled([
        facultyApi.listQuestions({ limit: 500 }),
        facultyApi.listQuizzes({ limit: 500 }),
      ]);

      const ids = new Set<string>();
      if (questions.status === 'fulfilled') {
        questions.value.forEach((q) => {
          if (q.subject_id) ids.add(q.subject_id);
        });
      }
      if (quizzes.status === 'fulfilled') {
        quizzes.value.forEach((qz) => {
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Faculty Assignments</h1>
        <p className="text-sm text-gray-500 mt-1">
          Review class and subject assignments registered for your faculty account.
        </p>
      </div>

      {/* Backend Architecture Note */}
      <Card className="p-5 border-amber-200 bg-amber-50">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 space-y-2">
            <h3 className="font-semibold text-base">Backend Contract Architecture Notice</h3>
            <p>
              In the CampusQuiz backend, faculty assignments to academic classes and subjects are
              exclusively managed via the administrative endpoint:
            </p>
            <code className="inline-block px-2 py-1 bg-amber-100 rounded text-xs font-mono text-amber-900">
              /api/v1/admin/academic/faculty-assignments
            </code>
            <p>
              That endpoint requires the <Badge variant="purple" size="sm">ADMIN</Badge> role.
              The backend does not currently provide a dedicated self-service endpoint (such as{' '}
              <code className="font-mono text-xs">/api/v1/faculty/me/assignments</code>) for
              non-admin faculty members to query their assignments directly.
            </p>
            <p>
              To author questions and create quizzes, use the Subject UUID assigned by your college
              curriculum coordinator.
            </p>
          </div>
        </div>
      </Card>

      {/* Detected Subjects from Authoring Activity */}
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
