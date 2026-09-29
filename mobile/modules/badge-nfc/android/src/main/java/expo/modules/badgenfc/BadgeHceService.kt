package expo.modules.badgenfc

import android.nfc.cardemulation.HostApduService
import android.os.Bundle

/**
 * Host card emulation: when the phone touches a reader, Android routes the reader's commands
 * here. It answers as a Type 4 tag whose content is the badge code currently on screen; with no
 * badge on screen (app closed, badge screen left) it answers "not found".
 */
class BadgeHceService : HostApduService() {
  private val tag = Type4Tag { BadgePayload.current }

  override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray =
    if (commandApdu == null) Type4Tag.SW_WRONG_LENGTH else tag.process(commandApdu)

  override fun onDeactivated(reason: Int) { tag.reset() }
}

/** The code shown right now, set by the app every 30 seconds; null when the badge is not on screen. */
object BadgePayload {
  @Volatile var current: String? = null
}
