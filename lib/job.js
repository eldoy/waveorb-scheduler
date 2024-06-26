var util = require('./util.js')

function getStatus(status, options, error) {
  var schedule
  if (status == 'enqueued') {
    schedule = util.parseSchedule(options)
  }

  return {
    status,
    timestamp: new Date(),
    schedule,
    error: error?.message
  }
}

module.exports = function (config) {
  var log = require('./log.js')(config)

  var { db } = config

  async function create(job, repeat = false) {
    log('🛠  Adding job', job.name)

    var options = repeat ? { repeat: job.options.repeat } : job.options
    var enqueued = getStatus('enqueued', options)

    return db('job').create({
      parentId: job.parentId || job._id || job.id,
      name: job.name,
      payload: job.payload,
      options: job.options,
      status: [enqueued]
    })
  }

  async function updateStatus(job, status, error) {
    return db.base.collection('job').findOneAndUpdate(
      { _id: job._id || job.id },
      {
        $push: {
          status: {
            $each: [getStatus(status, job.options, error)],
            $position: 0
          }
        }
      }
    )
  }

  async function archive(id) {
    var job = await db('job').get(id)
    if (job) {
      await Promise.all([db('job-history').create(job), db('job').delete(id)])
    }
  }

  async function process(callback, job) {
    var jobId = job._id || job.id
    var name = job.name

    log('🔥 Processing job', job.name, jobId)

    await updateStatus(job, 'processing')

    try {
      await callback(job.payload, job.options)
      await updateStatus(job, 'processed')
      log('✅ Processed job', name, jobId)
    } catch (err) {
      await updateStatus(job, 'failed', err)
      log('❌ Failed job', name, jobId)
    } finally {
      await archive(jobId)
    }

    if (job.options.repeat) {
      await create(job, true)
    }
  }

  async function schedule(callback, job) {
    log('⏰ Scheduling job', job.name, job._id || job.id)
    var diff = job.status[0].schedule.getTime() - new Date().getTime()

    setTimeout(async function () {
      return process(callback, job)
    }, diff)
  }

  return { create, schedule }
}
