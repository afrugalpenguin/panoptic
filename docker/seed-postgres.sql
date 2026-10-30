-- Dev seed for Panoptic's Postgres backend: two databases with enough objects to make the tree realistic,
-- plus the shapes the tree has to handle (quoted names, a partitioned table, overloads, a materialized view).
-- Synthetic data only. Idempotent: drops and recreates the seed databases. Run with psql -f.
\set ON_ERROR_STOP on

DROP DATABASE IF EXISTS orders WITH (FORCE);
DROP DATABASE IF EXISTS inventory WITH (FORCE);
CREATE DATABASE orders;
CREATE DATABASE inventory;

\connect orders

CREATE SCHEMA sales;
CREATE SCHEMA audit;

CREATE TABLE public.customer (
    customer_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id varchar(20) NOT NULL,
    name text NOT NULL,
    email varchar(320),
    created_utc timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_customer_email UNIQUE (tenant_id, email)
);

CREATE TYPE sales.order_status AS ENUM ('open', 'shipped', 'closed');

CREATE TABLE sales."order" (
    order_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id integer NOT NULL CONSTRAINT fk_order_customer REFERENCES public.customer (customer_id),
    status sales.order_status NOT NULL DEFAULT 'open',
    placed_utc timestamptz NOT NULL DEFAULT now(),
    total numeric(18, 2) NOT NULL
);
CREATE INDEX ix_order_customer ON sales."order" (customer_id, placed_utc DESC);

-- A name that needs quoting: mixed case and a space.
CREATE TABLE sales."Order Lines" (
    order_id bigint NOT NULL REFERENCES sales."order" (order_id),
    line_no integer NOT NULL,
    sku text NOT NULL,
    qty integer NOT NULL CHECK (qty > 0),
    "UnitPrice" numeric(18, 2) NOT NULL,
    PRIMARY KEY (order_id, line_no)
);

-- Partitioned: the tree shows audit.change_log once, not its partitions.
CREATE TABLE audit.change_log (
    id bigint GENERATED ALWAYS AS IDENTITY,
    table_name text NOT NULL,
    changed_utc timestamptz NOT NULL,
    payload jsonb,
    PRIMARY KEY (id, changed_utc)
) PARTITION BY RANGE (changed_utc);
CREATE TABLE audit.change_log_2026 PARTITION OF audit.change_log FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE audit.change_log_2027 PARTITION OF audit.change_log FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE VIEW sales.open_orders AS SELECT * FROM sales."order" WHERE status = 'open';
CREATE MATERIALIZED VIEW sales.daily_totals AS
    SELECT date_trunc('day', placed_utc) AS day, sum(total) AS total FROM sales."order" GROUP BY 1;
CREATE INDEX ix_daily_totals_day ON sales.daily_totals (day);

-- Overloads: the tree labels them with their argument types.
CREATE FUNCTION public.order_count(p_customer_id integer) RETURNS bigint LANGUAGE sql STABLE
    AS $$ SELECT count(*) FROM sales."order" WHERE customer_id = p_customer_id $$;
CREATE FUNCTION public.order_count(p_customer_id integer, p_status sales.order_status) RETURNS bigint LANGUAGE sql STABLE
    AS $$ SELECT count(*) FROM sales."order" WHERE customer_id = p_customer_id AND status = p_status $$;
CREATE PROCEDURE sales.close_order(p_order_id bigint) LANGUAGE sql
    AS $$ UPDATE sales."order" SET status = 'closed' WHERE order_id = p_order_id $$;

CREATE SEQUENCE sales.invoice_no START 1000;

INSERT INTO public.customer (tenant_id, name, email)
SELECT 't-' || (i % 5), 'Customer ' || i, 'customer' || i || '@example.com' FROM generate_series(1, 50) AS i;
INSERT INTO sales."order" (customer_id, status, total)
SELECT 1 + (i % 50), (ARRAY['open', 'shipped', 'closed']::sales.order_status[])[1 + i % 3], i * 10.5 FROM generate_series(1, 200) AS i;
REFRESH MATERIALIZED VIEW sales.daily_totals;

-- Enough tables to make the Tables folder long, like the SQL seed's lookups.
DO $$
BEGIN
    FOR i IN 1..150 LOOP
        EXECUTE format('CREATE TABLE public.lookup_%s (id integer PRIMARY KEY, code varchar(20) NOT NULL, label text, sort_order smallint NOT NULL DEFAULT 0)',
            lpad(i::text, 3, '0'));
    END LOOP;
END $$;

\connect inventory

CREATE TABLE public.warehouse (warehouse_id integer PRIMARY KEY, name text NOT NULL, region varchar(20) NOT NULL);
CREATE TABLE public.stock (
    warehouse_id integer NOT NULL REFERENCES public.warehouse (warehouse_id),
    sku text NOT NULL,
    on_hand integer NOT NULL,
    PRIMARY KEY (warehouse_id, sku)
);
CREATE VIEW public.low_stock AS SELECT * FROM public.stock WHERE on_hand < 10;
