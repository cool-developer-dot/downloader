# P13 #667 Chromecast: the Cast SDK creates the OptionsProvider named in AndroidManifest.xml by reflection
# (Class.forName + the no-argument constructor). The Cast AAR keeps the class and its methods; this keeps the
# constructor too, which R8's full mode would otherwise remove.
-keep class com.vidorax.media.cast.CastOptionsProvider {
  public <init>();
}
