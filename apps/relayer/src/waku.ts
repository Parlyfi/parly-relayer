import { createDecoder, createLightNode, Protocols, waitForRemotePeer } from "@waku/sdk"
import { requireEnv, requirePositiveInt } from "@parly/env-utils"
import { getWakuContentTopicVariants, requireWakuContentTopic } from "./waku-content-topic.js"

export async function startWakuRelay(onPayload: (payload: Uint8Array) => Promise<void>) {
  const contentTopic = requireWakuContentTopic("WAKU_CONTENT_TOPIC")
  const contentTopics = getWakuContentTopicVariants("WAKU_CONTENT_TOPIC")
  const clusterId = requirePositiveInt("WAKU_CLUSTER_ID")
  const bootstrap = requireEnv("WAKU_BOOTSTRAP")
  if (bootstrap !== "true" && bootstrap !== "false") {
    throw new Error("WAKU_BOOTSTRAP must be either true or false.")
  }

  const node = await createLightNode({
    defaultBootstrap: bootstrap === "true",
    networkConfig: {
      clusterId,
      contentTopics
    }
  })

  await node.start()
  await waitForRemotePeer(node, [Protocols.Filter])

  const decoders = contentTopics.map((topic) => createDecoder(topic))
  const { error, subscription } = await (node.filter as any).createSubscription({
    contentTopics
  })

  if (error) throw new Error(error)

  await subscription.subscribe(decoders, async (msg: any) => {
    if (!msg.payload) return
    await onPayload(msg.payload)
  })

  return node
}
