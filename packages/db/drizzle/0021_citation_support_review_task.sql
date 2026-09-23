-- MOO-841, decision 017: low-confidence citation-support removals become pointer-only review tasks (entity =
-- briefing_run, reason = sentence id + verdict + confidence; never the sentence text, because review_tasks is shared
-- across orgs). The shared review queue leaves this type out until an org-checked viewer exists.
ALTER TYPE "public"."review_task_type" ADD VALUE 'citation_support_review';
