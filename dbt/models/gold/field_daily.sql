{{ config(
    materialized='incremental',
    file_format='iceberg',
    incremental_strategy='merge',
    on_schema_change='append_new_columns',
    unique_key=['field_id', 'metric', 'day'],
    partition_by=['day']
) }}

-- Daily min, max and average per field and metric. Statistics use only readings with
-- quality_flag = 'ok', so a flagged spike can never reach a dashboard (FR4.6); the counts keep
-- every non-null reading so the share of flagged data stays visible.
select
    field_id,
    farm_id,
    metric,
    cast(date_trunc('day', measured_at) as date) as day,
    min(case when quality_flag = 'ok' then value end) as min_value,
    max(case when quality_flag = 'ok' then value end) as max_value,
    avg(case when quality_flag = 'ok' then value end) as avg_value,
    count(*) as reading_count,
    sum(case when quality_flag = 'ok' then 1 else 0 end) as valid_count,
    sum(case when quality_flag <> 'ok' then 1 else 0 end) as flagged_count
from {{ ref('sensor_readings') }}
where value is not null
  {% if is_incremental() %}
  and cast(measured_at as date) >= date_sub(current_date(), {{ var('gold_lookback_days') }})
  {% endif %}
group by 1, 2, 3, 4
