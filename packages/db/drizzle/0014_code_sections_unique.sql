DROP INDEX "code_sections_doc_sort_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "code_sections_doc_section_sort_idx" ON "code_sections" USING btree ("source_document_id","section","sort_order");