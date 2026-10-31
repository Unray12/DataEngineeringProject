{{ config(materialized='table') }}

with counters as (
    select
        cast(date_trunc('day', window_start) as date) as day,
        sum(total) as total,
        sum(valid) as valid,
        sum(duplicate) as duplicate,
        sum(out_of_range) as out_of_range,
        sum(null_value) as quarantined
    from {{ source('ops', 'quality_counters') }}
    group by 1
),
quarantine as (
    select cast(date_trunc('day', detected_at) as date) as day, count(*) as quarantined
    from {{ source('ops', 'quarantine') }}
    group by 1
)
select
    c.day,
    c.valid,
    c.duplicate,
    c.out_of_range,
    coalesce(q.quarantined, c.quarantined, 0) as quarantined,
    c.total
from counters c
left join quarantine q on q.day = c.day
