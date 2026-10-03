import type { Idea, IdeaEvaluation } from '../types';

export function isInboxIdea(idea: Idea): boolean {
  return !idea.deletedAt && Boolean(idea.capturedAt) && !idea.processedAt;
}

export function isExecutionIdea(idea: Idea): boolean {
  return !idea.deletedAt && (idea.status === 'planned' || idea.status === 'building');
}

export function isStaleIdea(idea: Idea, days = 30): boolean {
  return !idea.deletedAt && !['done', 'archived'].includes(idea.status) &&
    Date.now() - new Date(idea.updatedAt).getTime() > days * 86400000;
}

export function scoreIdea(evaluation?: IdeaEvaluation): number {
  if (!evaluation) return 0;
  const positive = evaluation.problemSeverity + evaluation.excitement + evaluation.strategicFit + evaluation.confidence;
  return Math.max(0, Math.min(100, Math.round((positive / 20) * 100 - (evaluation.effort / 5) * 10)));
}

export function scoreExplanation(evaluation: IdeaEvaluation): string {
  return `Problem ${evaluation.problemSeverity}/5 + excitement ${evaluation.excitement}/5 + fit ${evaluation.strategicFit}/5 + confidence ${evaluation.confidence}/5; effort ${evaluation.effort}/5 reduces the score by ${evaluation.effort * 2} points.`;
}

export function scoreLabel(score: number): string {
  if (score >= 75) return 'High potential';
  if (score >= 50) return 'Promising';
  return 'Needs clarity';
}
