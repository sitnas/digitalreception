// APDU exchange as a phone or Chrome reader performs it (NFC Forum Type 4 Tag 2.0).
import expo.modules.badgenfc.Type4Tag
import expo.modules.badgenfc.Type4Tag.Companion.hex
import kotlin.test.*

class Type4TagTest {
  private fun ok(r: ByteArray) = assertEquals("9000", r.takeLast(2).toByteArray().toHexString(), "status of ${r.toHexString()}")
  private fun ByteArray.toHexString() = joinToString("") { "%02X".format(it) }
  private fun sw(r: ByteArray) = r.takeLast(2).toByteArray().toHexString()
  private fun body(r: ByteArray) = r.copyOfRange(0, r.size - 2)

  /** What an Android/Chrome reader does, step by step (NFC Forum T4T 2.0). */
  private fun readTag(tag: Type4Tag, le: Int = 0x3B): String? {
    if (sw(tag.process(hex("00A4040007D276000085010100"))) != "9000") return null
    ok(tag.process(hex("00A4000C02E103")))
    val cc = body(tag.process(hex("00B000000F")))
    assertEquals("000F20003B00340406E104010000FF", cc.toHexString())
    ok(tag.process(hex("00A4000C02E104")))
    val nlenBytes = body(tag.process(hex("00B0000002")))
    val nlen = ((nlenBytes[0].toInt() and 0xFF) shl 8) or (nlenBytes[1].toInt() and 0xFF)
    val ndef = ArrayList<Byte>()
    var off = 2
    while (ndef.size < nlen) {
      val n = minOf(le, nlen - ndef.size)
      val r = tag.process(byteArrayOf(0x00, 0xB0.toByte(), (off shr 8).toByte(), off.toByte(), n.toByte()))
      ok(r); ndef.addAll(body(r).toList()); off += n
    }
    val rec = ndef.toByteArray()
    assertEquals(0xD1, rec[0].toInt() and 0xFF, "MB|ME|SR, TNF well-known")
    assertEquals(1, rec[1].toInt()); assertEquals('T'.code, rec[3].toInt())
    val len = rec[2].toInt() and 0xFF
    val payload = rec.copyOfRange(4, 4 + len)
    val langLen = payload[0].toInt() and 0x3F
    assertEquals("en", String(payload, 1, langLen, Charsets.US_ASCII))
    return String(payload, 1 + langLen, payload.size - 1 - langLen, Charsets.UTF_8)
  }

  private val code = "DRE1:3f0c5a2e-1b7d-4c1e-9a55-2f1c7d0e9b11.58123456.0123456789abcdef"

  @Test fun `reader gets the current code`() {
    assertEquals(code, readTag(Type4Tag { code }))
  }

  @Test fun `small reads (Le 16) reassemble the same code`() {
    assertEquals(code, readTag(Type4Tag { code }, le = 16))
  }

  @Test fun `no badge on screen - the application does not exist`() {
    val tag = Type4Tag { null }
    assertEquals("6A82", sw(tag.process(hex("00A4040007D276000085010100"))))
    assertNull(readTag(tag))
  }

  @Test fun `code is frozen for one tap and refreshed on the next`() {
    var current = "DRE1:a"
    val tag = Type4Tag { current }
    ok(tag.process(hex("00A4040007D276000085010100")))
    ok(tag.process(hex("00A4000C02E104")))
    current = "DRE1:b"
    val first = body(tag.process(hex("00B0000010")))
    assertTrue(String(first, Charsets.UTF_8).contains("DRE1:a"))
    tag.reset()
    assertEquals("DRE1:b", readTag(tag))
  }

  @Test fun `other applications, files and commands are refused`() {
    val tag = Type4Tag { code }
    assertEquals("6A82", sw(tag.process(hex("00A4040007A000000003101000"))))
    assertEquals("6A82", sw(tag.process(hex("00A4000C02E103"))), "no file select before the application")
    ok(tag.process(hex("00A4040007D276000085010100")))
    assertEquals("6A82", sw(tag.process(hex("00A4000C02E105"))))
    assertEquals("6986", sw(tag.process(hex("00B0000002"))), "read without a selected file")
    assertEquals("6D00", sw(tag.process(hex("00D6000001FF"))), "no UPDATE BINARY: read only")
    assertEquals("6E00", sw(tag.process(hex("90A4040000"))))
    assertEquals("6700", sw(tag.process(hex("00A4"))))
    ok(tag.process(hex("00A4000C02E103")))
    assertEquals("6B00", sw(tag.process(hex("00B0010002"))), "offset past the end")
  }
}
