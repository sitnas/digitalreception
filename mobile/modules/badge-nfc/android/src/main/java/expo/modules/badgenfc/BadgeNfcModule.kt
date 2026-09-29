package expo.modules.badgenfc

import android.content.Intent
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BadgeNfcModule : Module() {
  private val context get() = appContext.reactContext

  override fun definition() = ModuleDefinition {
    Name("BadgeNfc")

    /** The phone can act as an NFC card (hardware and Android support). */
    Function("isSupported") {
      val ctx = context ?: return@Function false
      NfcAdapter.getDefaultAdapter(ctx) != null &&
        ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)
    }

    /** NFC is switched on in the phone settings. */
    Function("isEnabled") {
      val ctx = context ?: return@Function false
      NfcAdapter.getDefaultAdapter(ctx)?.isEnabled == true
    }

    /** Code to hand to readers; null stops answering. */
    Function("setPayload") { payload: String? ->
      BadgePayload.current = payload
    }

    Function("openSettings") {
      context?.startActivity(Intent(Settings.ACTION_NFC_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      Unit
    }

    OnDestroy { BadgePayload.current = null }
  }
}
