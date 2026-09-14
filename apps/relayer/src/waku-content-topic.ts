import { requireEnv } from "@parly/env-utils"

const VALID_CONTENT_TOPIC_EXAMPLES =
  "/parly/16.9.9/app/proto or /0/parly/16.9.9/app/proto"

function parseContentTopic(
  name = "WAKU_CONTENT_TOPIC",
  env: NodeJS.ProcessEnv = process.env
) {
  const contentTopic = requireEnv(name, env)
  const parts = contentTopic.split("/").filter(Boolean)
  let payload = parts

  if (parts.length === 5 || parts.length === 7) {
    const generation = parts[0]
    if (!generation || !/^-?\d+$/.test(generation)) {
      throw new Error(`${name} generation segment must be an integer.`)
    }
    if (Number(generation) > 0) {
      throw new Error(`${name} generation segment must be 0 or negative.`)
    }
    payload = parts.slice(1)
  }

  if (payload.length !== 4 && payload.length !== 6) {
    throw new Error(`${name} must look like ${VALID_CONTENT_TOPIC_EXAMPLES}.`)
  }

  const [application, version, topicName, encoding] =
    payload.length === 4
      ? payload
      : [payload[0], `${payload[1]}.${payload[2]}.${payload[3]}`, payload[4], payload[5]]

  if (!application || !version || !topicName || !encoding) {
    throw new Error(`${name} must look like ${VALID_CONTENT_TOPIC_EXAMPLES}.`)
  }

  return {
    application,
    version,
    topicName,
    encoding
  }
}

export function requireWakuContentTopic(
  name = "WAKU_CONTENT_TOPIC",
  env: NodeJS.ProcessEnv = process.env
) {
  const { application, version, topicName, encoding } = parseContentTopic(name, env)
  return `/0/${application}/${version}/${topicName}/${encoding}`
}

export function getWakuContentTopicVariants(
  name = "WAKU_CONTENT_TOPIC",
  env: NodeJS.ProcessEnv = process.env
) {
  const { application, version, topicName, encoding } = parseContentTopic(name, env)
  const generated = `/0/${application}/${version}/${topicName}/${encoding}`
  const dotted = `/${application}/${version}/${topicName}/${encoding}`
  return [...new Set([generated, dotted])]
}
