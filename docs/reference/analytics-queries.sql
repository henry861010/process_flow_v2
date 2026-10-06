-- All timestamps are UTC. Change the environment/date bounds for your deployment.
-- 1. Request volume, polling vs operations, failure rate and mean latency.
SELECT substr(occurred_at,1,10) AS utc_day, traffic_kind, route,
       count(*) AS requests,
       sum(CASE WHEN status_code >= 400 OR completion_state <> 'completed' THEN 1 ELSE 0 END) AS failures,
       round(avg(duration_ms),2) AS mean_duration_ms
FROM api_requests WHERE environment='production'
GROUP BY utc_day,traffic_kind,route ORDER BY utc_day DESC,requests DESC;

-- 2. Flow creation (fixtures/imports are not emitted as individual creations).
SELECT dataset_id, event_name, count(*) AS creations
FROM usage_events WHERE environment='production' AND phase='finished'
AND outcome='success' AND event_name IN ('flow_template.create','flow_instance.create')
GROUP BY dataset_id,event_name;

-- 3. Flow usage attempts and success, with polling excluded by construction.
-- Export submission failures have request-based operation ids; accepted jobs have job ids.
SELECT dataset_id,flow_template_id,event_name, count(DISTINCT operation_id) AS attempts,
       sum(CASE WHEN outcome='success' THEN 1 ELSE 0 END) AS successes,
       sum(CASE WHEN outcome='failure' THEN 1 ELSE 0 END) AS failures,
       round(avg(duration_ms),2) AS mean_duration_ms
FROM usage_events WHERE environment='production'
AND (phase='finished' OR (event_name='export' AND phase='accepted'))
AND event_name IN ('flow.preview','flow_instance.execute','export')
GROUP BY dataset_id,flow_template_id,event_name ORDER BY attempts DESC;

-- 4. Step templates referenced by successful flow operations (not step execution counts).
SELECT j.value AS step_template_id,count(*) AS referenced_by_operations
FROM usage_events e,json_each(e.properties_json,'$.step_template_ids') j
WHERE e.environment='production' AND e.phase='finished' AND e.outcome='success'
AND e.event_name IN ('flow.preview','flow_instance.execute','export')
GROUP BY j.value ORDER BY referenced_by_operations DESC;

-- 5. Generator recipes referenced by successful flow operations.
SELECT json_extract(j.value,'$.id') AS generator_id,
       json_extract(j.value,'$.version') AS generator_version,count(*) AS referenced_by_operations
FROM usage_events e,json_each(e.properties_json,'$.generators') j
WHERE e.environment='production' AND e.phase='finished' AND e.outcome='success'
AND e.event_name IN ('flow.preview','flow_instance.execute','export')
GROUP BY generator_id,generator_version ORDER BY referenced_by_operations DESC;

-- 6. Deployment comparisons and stable error categories.
SELECT app_version,event_name,outcome,error_code,count(*) AS operations,
       round(avg(duration_ms),2) AS mean_duration_ms
FROM usage_events WHERE environment='production' AND phase='finished'
GROUP BY app_version,event_name,outcome,error_code;

-- 7. Median / p95 execution latency for synchronous operations and finished exports.
WITH ranked AS (
 SELECT event_name,duration_ms,
        row_number() OVER (PARTITION BY event_name ORDER BY duration_ms) AS n,
        count(*) OVER (PARTITION BY event_name) AS total
 FROM usage_events WHERE environment='production' AND phase='finished'
 AND duration_ms IS NOT NULL AND event_name IN ('flow.preview','flow_instance.execute','export')
)
SELECT event_name,
       max(CASE WHEN n=(total+1)/2 THEN duration_ms END) AS median_lower_ms,
       max(CASE WHEN n=(95*total+99)/100 THEN duration_ms END) AS p95_ms
FROM ranked GROUP BY event_name;

-- 8. Future identified user count; unknown is never a person.
SELECT count(DISTINCT request_owner) AS identified_users FROM usage_events
WHERE environment='production' AND request_owner<>'unknown' AND phase='finished';

-- 9. Known analytics loss (crash losses may be unknowable).
SELECT occurred_at,json_extract(properties_json,'$.lost_record_count') AS lost_records
FROM usage_events WHERE event_name='analytics.gap' ORDER BY occurred_at;
