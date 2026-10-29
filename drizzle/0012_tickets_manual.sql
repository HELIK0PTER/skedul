-- Custom SQL migration file, put your code below! --
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE occurrence ADD CONSTRAINT occurrence_rdv_excl
  EXCLUDE USING gist (professional_id WITH =, tstzrange(block_start, block_end) WITH &&)
  WHERE (event_id IS NULL AND status = 'scheduled');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION skedul_assert(ok boolean, code text) RETURNS boolean LANGUAGE plpgsql AS
$$BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'skedul:' || code; END IF; RETURN true; END$$;
