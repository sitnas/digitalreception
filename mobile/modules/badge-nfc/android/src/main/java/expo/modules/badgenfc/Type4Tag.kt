package expo.modules.badgenfc

/**
 * NFC Forum Type 4 Tag (mapping version 2.0) answering with a single NDEF Text record.
 * Pure Kotlin, no Android classes: the APDU exchange is unit-tested on the JVM.
 *
 * Reader flow: SELECT the NDEF application, SELECT the capability container (E103), READ it,
 * SELECT the NDEF file (E104), READ its length then its content.
 */
class Type4Tag(private val payload: () -> String?) {
  private enum class File { NONE, CC, NDEF }

  private var appSelected = false
  private var selected = File.NONE
  /** Built when the NDEF file is selected, so one tap reads one consistent code. */
  private var ndefFile: ByteArray = ByteArray(0)

  fun reset() { appSelected = false; selected = File.NONE; ndefFile = ByteArray(0) }

  fun process(apdu: ByteArray): ByteArray {
    if (apdu.size < 4) return SW_WRONG_LENGTH
    val cla = apdu[0].toInt() and 0xFF
    val ins = apdu[1].toInt() and 0xFF
    val p1 = apdu[2].toInt() and 0xFF
    val p2 = apdu[3].toInt() and 0xFF
    if (cla != 0x00) return SW_CLA_NOT_SUPPORTED
    return when (ins) {
      0xA4 -> select(p1, p2, apdu)
      0xB0 -> readBinary((p1 shl 8) or p2, apdu)
      else -> SW_INS_NOT_SUPPORTED
    }
  }

  private fun data(apdu: ByteArray): ByteArray? {
    if (apdu.size < 5) return null
    val lc = apdu[4].toInt() and 0xFF
    if (apdu.size < 5 + lc) return null
    return apdu.copyOfRange(5, 5 + lc)
  }

  private fun select(p1: Int, p2: Int, apdu: ByteArray): ByteArray {
    val d = data(apdu) ?: return SW_WRONG_LENGTH
    if (p1 == 0x04) { // by application name
      if (!d.contentEquals(NDEF_AID)) { reset(); return SW_FILE_NOT_FOUND }
      // No badge on screen: behave as if the application did not exist.
      if (payload() == null) { reset(); return SW_FILE_NOT_FOUND }
      appSelected = true; selected = File.NONE
      return SW_OK
    }
    if (p1 == 0x00 && p2 == 0x0C && appSelected) { // by file id
      return when {
        d.contentEquals(CC_ID) -> { selected = File.CC; SW_OK }
        d.contentEquals(NDEF_ID) -> {
          val text = payload() ?: return SW_FILE_NOT_FOUND
          ndefFile = ndefFileFor(text); selected = File.NDEF; SW_OK
        }
        else -> SW_FILE_NOT_FOUND
      }
    }
    return SW_FILE_NOT_FOUND
  }

  private fun readBinary(offset: Int, apdu: ByteArray): ByteArray {
    val file = when (selected) { File.CC -> CC_FILE; File.NDEF -> ndefFile; File.NONE -> return SW_NOT_ALLOWED }
    val le = if (apdu.size >= 5) (apdu[apdu.size - 1].toInt() and 0xFF).let { if (it == 0) 256 else it } else 256
    if (offset > file.size) return SW_WRONG_P1P2
    val end = minOf(file.size, offset + le)
    return file.copyOfRange(offset, end) + SW_OK
  }

  companion object {
    val NDEF_AID = hex("D2760000850101")
    val CC_ID = hex("E103")
    val NDEF_ID = hex("E104")
    const val MAX_NDEF = 0x0100
    /** CCLEN 15, mapping 2.0, MLe 0x003B, MLc 0x0034, NDEF file control TLV: E104, max size, read free, write denied. */
    val CC_FILE = hex("000F" + "20" + "003B" + "0034" + "04" + "06" + "E104" + "%04X".format(MAX_NDEF) + "00" + "FF")

    val SW_OK = hex("9000")
    val SW_FILE_NOT_FOUND = hex("6A82")
    val SW_WRONG_LENGTH = hex("6700")
    val SW_WRONG_P1P2 = hex("6B00")
    val SW_NOT_ALLOWED = hex("6986")
    val SW_INS_NOT_SUPPORTED = hex("6D00")
    val SW_CLA_NOT_SUPPORTED = hex("6E00")

    /** NDEF file: 2-byte length + one short Text record ("en", UTF-8) with the badge code. */
    fun ndefFileFor(text: String): ByteArray {
      val lang = "en".toByteArray(Charsets.US_ASCII)
      val body = byteArrayOf(lang.size.toByte()) + lang + text.toByteArray(Charsets.UTF_8)
      require(body.size <= 255) { "badge code too long" }
      // MB | ME | SR, TNF = 1 (NFC Forum well-known type), type "T"
      val record = byteArrayOf(0xD1.toByte(), 0x01, body.size.toByte(), 'T'.code.toByte()) + body
      return byteArrayOf((record.size shr 8).toByte(), record.size.toByte()) + record
    }

    fun hex(s: String): ByteArray = ByteArray(s.length / 2) { i -> s.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
  }
}
